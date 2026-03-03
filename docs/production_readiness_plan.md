Production Readiness Recommendations and Execution Plan
Scope

This plan covers architecture hardening for the current visualization app (API, orchestration, observability, image generation, sourced image pipeline, and CLIP service).
Priority Levels

    Critical: Must be done before production exposure.

    High: Should be done in first production cycle.

    Medium: Important reliability and operability improvements.

    Nice to Have: Enhancements after stable production baseline.

1) [DONE] Unified Data Storage Layer: PostgreSQL (Critical)
1. Issue

Generation and control endpoints currently lack a centralized, persistent identity context and task state.
2. High-level Plan

Implement a Unified PostgreSQL Data Layer to serve as the single source of truth for User Management, API Authentication, and Task Queue Management.
3. Design Specifications

    Unified Schema:

        users Table: Store id, name, email, hashed api_key, and daily_quota.

        tasks Table: Store id, user_id, status (queued, processing, completed, failed), payload (JSONB), result_url, error_log, and updated_at.

    API Auth Guard: Implement middleware to validate x-api-key headers directly against the PostgreSQL users table on every request.

    Identity Context: Inject the user_id into all logs and task metadata to ensure traceability and auditability.

4. Validation

    Unauthorized calls return 401.

    Successful auth attaches the correct user context to the request.

    Database indexes on api_key ensure sub-millisecond authentication lookups.

2) [DONE] PostgreSQL-Based Durable Queue (Critical)
1. Issue

Current in-process queue is volatile; service restarts or crashes lose all in-flight image generation tasks.
2. High-level Plan

Replace the volatile in-memory queue with a Durable SQL-Backed Queue using PostgreSQL row-level locking for atomic task distribution.
3. Design Specifications

    Atomic Worker Pull: Workers utilize the FOR UPDATE SKIP LOCKED pattern to safely claim the next available task without race conditions.

    Worker Separation: Separate the API process from the Worker process to prevent heavy CLIP/Vision processing from impacting API responsiveness.

    Task Lifecycle: Persist all state transitions in the tasks table, including retry metadata and error logs.

    Janitor/Heartbeat: Implement a cleanup process to reset "orphaned" tasks (stuck in processing longer than 10 minutes) back to queued.

4. Validation

    Restarting the API or Worker while tasks are running does not lose task state.

    Multiple workers can scale horizontally and pull from the same table without duplication.

3) [done] CORS and WebSocket Access Hardening (Critical)
1. Issue

WebSocket gateway currently allows broad origins and lacks authenticated handshakes, creating security risks.
2. High-level Plan

Restrict browser origins and require database-backed token/key validation during the WebSocket handshake.
3. Design Specifications

    Origin Allowlist: Replace wildcard CORS with strict ALLOWED_ORIGINS environment variables for both HTTP and WS.

    WS Auth Middleware: Validate the API key against PostgreSQL during the connection phase.

    Reject unauthenticated socket connections and untrusted origins immediately.

4. Validation

    Disallowed origins or invalid tokens result in failed connections.

    Observability UI functions only within authenticated, trusted sessions.

4) [done] Input Validation and Payload Limits (Critical)
1. Issue

Large, unvalidated inputs increase the risk of database bloat, injection, and service crashes.
2. High-level Plan

Enforce strict DTO (Data Transfer Object) schemas and payload size limits before data enters the PostgreSQL layer.
3. Design Specifications

    Schema Enforcement: Use ValidationPipe to reject unknown fields in JSONB task payloads.

    Size Constraints: Add max limits for lesson counts, visualization counts, and text lengths at the Express/Nest layer.

    Payload Limits: Enforce strict payload size limits to prevent memory exhaustion during request parsing.

4. Validation

    Malformed or oversized payloads return 400 or 413 errors with clear reasons.

    Valid payloads continue to pass and populate the database correctly.

5) Secrets Management and PostgreSQL Security (Critical)
1. Issue

High-value provider keys (Flux, Pixabay) and database credentials must not reside in plaintext or repository files.
2. High-level Plan

Utilize platform secret stores and implement a strict "Startup Handshake" for database connectivity.
3. Design Specifications

    Secret Injection: Use platform secrets (e.g., Railway, Render) for the PostgreSQL connection string and API keys.

    Startup Validation: App must fail-fast if required environment variables are missing or if the database is unreachable.

    Document rotation and emergency revocation procedures for all high-value keys.

    While the app is running locally, the "ask" is to move the app's security model from "Trusting" to "Verifying." You want the agent to build the Infrastructure for Secrets, not just the secrets themselves:

    Strict Startup Validator: Implement a service that runs at the very beginning of the bootstrap process. It must check for the presence of all required environment variables (e.g., DATABASE_URL, PIXABAY_API_KEY, FLUX_API_KEY).

    Fail-Fast Handshake: If the DATABASE_URL is present but the app cannot establish a connection or find the users table, the app must throw a critical error and exit immediately. This prevents "silent failures" where you think the app is working but it's not actually persisting task data.

    The .env.example Filter: Ensure the agent creates a clean .env.example file that lists all necessary keys without their values, and confirms that .env is strictly added to .gitignore.

4. Validation

    App fails to start if DATABASE_URL is missing.

    Rotation tests confirm app functionality remains stable after key updates.


[done] 5.B) Worker Heartbeat and Health: Distributed State Design

This redesigned specification moves the orchestration from a basic "Task Table" to a robust Distributed State Machine. It ensures that if a worker process dies while generating an image, the system automatically detects the failure, cleans up the state, and requeues the work without manual intervention.
🏛️ Refined Architectural Design
1. The worker_heartbeats Table

The single source of truth for the health and activity of every worker process in the cluster.

    Columns: worker_id (UUID), pid (Process ID), host (Hostname), started_at, last_seen_at (Timestamp), status (ACTIVE, SHUTDOWN, TERMINATED), capabilities (e.g., FLUX, PIXABAY, DOCX), and current_task_id (Foreign Key to tasks.id).

    Constraint: A worker_id must have a 1:1 binding with a current_task_id to prevent memory exhaustion from concurrent heavy tasks.

2. Heartbeat & Supervisor Logic

    The Heartbeat: Each worker process must update its last_seen_at every N seconds (defined by WORKER_HEARTBEAT_MS).

    The Supervisor Loop: An API-side background process that scans the worker_heartbeats table every M seconds.

    Orphaned Task Handshake: If a worker's last_seen_at exceeds WORKER_HEARTBEAT_TIMEOUT_MS, the Supervisor must:

        Mark the worker as TERMINATED.

        Append a "Worker Timeout" event to the tasks.error_log for the associated current_task_id.

        Reset the task status from processing to queued for retry.

⚙️ Recommended Configuration Baseline
Variable	Recommended Value	Purpose
WORKER_COUNT	2	Number of parallel worker processes to spawn.
WORKER_TASK_CONCURRENCY	1	Strict limit of one heavy generation task per worker.
WORKER_HEARTBEAT_MS	10000 (10s)	Frequency of worker check-ins.
WORKER_TIMEOUT_MS	30000 (30s)	Duration before a worker is declared "Dead".
WORKER_MAX_RESTARTS_PER_HOUR	6	Safety cap to prevent infinite crash-restart loops.
✅ Validation Suite: Proof of Health

To consider this implementation "Done," the coding agent must pass the following functional tests:

    The "Hard Kill" Test: Manually terminate a worker process (kill -9) mid-task. The Supervisor must detect the timeout, mark the worker TERMINATED, and return the task to the queued state within one timeout cycle.

    The "Zombie Task" Test: Manually set a task to processing in the DB but set the associated worker's last_seen_at to 1 hour ago. The Janitor must identify and recover this orphaned task.

    The "Concurrency Lock" Test: Submit a manifest with 10 images. Ensure that with WORKER_COUNT=2, exactly 2 tasks move to processing while 8 remain queued, respecting the FOR UPDATE SKIP LOCKED logic.

    Graceful Exit Test: Send a SIGTERM to a worker. It must attempt to set its status to SHUTDOWN and clear its current_task_id before exiting, allowing the Supervisor to ignore it.

[done] 5.C) Garbage Collection of Orphan Worker Processes

This section adds a "Self-Cleaning" layer to the infrastructure to ensure that the process list matches the state in the worker_heartbeats table.
1. Issue

Worker processes can become detached from the parent API process during crashes or improper shutdowns, leading to resource leaks and duplicate task processing.
2. High-level Plan

Implement a Process Identification & Cleanup utility that executes during the API "Startup Handshake" and periodically via the Supervisor.
3. Design Specifications

    PID Validation: The worker_heartbeats table must store the pid (Process ID) for every worker.

    Startup Sweep: Before spawning new workers, the API must:

        Scan the worker_heartbeats table for any entries marked ACTIVE.

        Check if those PIDs actually exist on the host OS.

        If the PID exists but doesn't respond to a "ScribeFlow" signature check, or if the PID is missing, the API must forcefully kill the orphan and mark the DB entry as TERMINATED.

    Cross-Platform Killing: Use a library like ps-node or tree-kill to ensure that when a worker is terminated, its entire sub-process tree (including any stray CLIP or browser instances) is reaped.

    Port/Socket Cleanup: Ensure the worker releases any local locks or sockets during the cleanup to prevent "Address already in use" errors on restart.

✅ Validation: The "Ghost Hunter" Test

To verify the Garbage Collection (GC) is working, the coding agent should perform this test:

    Spawn & Abandon: Start the app and trigger a worker task.

    Kill the Parent: Force-kill the API process (kill -9) while leaving the worker running.

    Restart & Observe: Restart the API.

    Expected Result: The API’s "Startup Sweep" should identify the orphan worker PID from the worker_heartbeats table, terminate it, and then spawn a fresh WORKER_COUNT of processes.

[done] 5.d) You’re correct. You need two GC policies, not one:

Process GC (kill orphan OS processes)
Registry GC (prune old worker_heartbeats rows so observability stays clean)
Right now you have process GC, but registry retention is too loose.

Recommended methodology
1) Worker lifecycle model
Use explicit states and transitions:

ACTIVE -> SHUTDOWN (graceful)
ACTIVE -> TERMINATED (crash/GC)
TERMINATED|SHUTDOWN -> ARCHIVED (optional) or delete after retention window
2) Retention windows (good for your scale: ~5 concurrent users)
Keep ACTIVE: always
Keep TERMINATED/SHUTDOWN: 30-60 minutes for debugging
Hard delete rows older than retention
This keeps forensic value without accumulating dead workers forever.

3) UI filtering policy
Default worker panel should show:

ACTIVE only
Optional toggle: “Show dead workers (last 60m)”
This prevents noise while preserving debug access.

4) Janitor cadence
Run every 5-10 min:

Requeue stuck tasks from dead workers (already doing)
Mark stale active workers TERMINATED
Delete old dead worker rows past retention
5) Stable identity policy
Use a stable worker_id format:

${host}-${slot} (e.g., app1-w1, app1-w2, app1-w3)
Not ${pid}-derived.
This avoids creating a new row every restart and drastically reduces dead-row growth.
Suggested env knobs
Add these:

WORKER_HEARTBEAT_RETENTION_MINUTES=60
WORKER_HEARTBEAT_SHOW_DEAD_MINUTES=60
WORKER_JANITOR_PURGE_EVERY_MS=300000
WORKER_IDENTITY_MODE=stable_slot
SQL policy (janitor step)
Mark stale active:
ACTIVE with last_seen_at < now() - timeout -> TERMINATED
Purge old dead:
DELETE FROM worker_heartbeats WHERE status IN ('TERMINATED','SHUTDOWN') AND updated_at < now() - interval '60 minutes'


[done] 6) Rate Limiting and Cost Controls (High)
1. Issue

Unbounded requests across different asset types (GenAI vs. Sourced) can lead to unpredictable billing spikes and API exhaustion.
2. High-level Plan

Implement a persistent, asset-specific "Count-Up" quota system in PostgreSQL that resets for all users at 00:00 UTC.
3. Design Specifications

    Environment-Defined Quotas:
    Define limits in your .env to allow for instant scaling without code changes:
    Bash

    # Daily limits per user
    QUOTA_SOURCED_IMAGE=100
    QUOTA_GENERATED_IMAGE=20
    QUOTA_CHART=50
    QUOTA_INFOGRAPHIC=10

    The daily_usage Table:
    Track usage per user, per day, per asset type.

        user_id (UUID), asset_type (Enum), usage_date (Date), current_count (Integer).

        Reset Logic: A unique constraint on (user_id, asset_type, usage_date) ensures that when a new day starts (UTC), a new row is automatically created starting at 0.

    The "Count-Up" Guard:
    Before processing a task, the Worker performs an atomic check:

        Fetch current_count where usage_date = CURRENT_DATE.

        If current_count >= ENV_LIMIT, reject the task with a 429 Too Many Requests error.

        If allowed, increment the count: UPDATE daily_usage SET current_count = current_count + 1 ....

    Cost Telemetry:
    Log the estimated USD cost in the tasks.metadata JSONB field based on the asset type to track burn rate in real-time.

✅ Validation Section: Quota & Cost Integrity

To ensure the system protects your budget, the coding agent must pass these tests:
Test Case	Procedure	Expected Result
Asset Isolation	Reach the limit for GENERATED_IMAGE. Immediately request a SOURCED_IMAGE.	The GenAI request fails (429), but the Sourced Image request succeeds.
Midnight Reset	Set a limit to 1. Use it at 23:59 UTC. Wait until 00:01 UTC.	The second request succeeds as a new usage_date row is initialized.
Atomic Race	Send 5 concurrent requests for a limit of 1.	Exactly 1 request increments the DB and succeeds; 4 fail with 429.
Telemetry Sync	Run 10 Infographic tasks.	The tasks table metadata correctly reflects the aggregate estimated cost for that user.

[done] 7) File System and Path Safety (High)
1. Issue

Path handling for locally stored artifacts must be constrained to prevent directory traversal attacks.
2. High-level Plan

Enforce root-scoped storage boundaries and use PostgreSQL result_url as the authoritative path.
3. Design Specifications

    Path Sanitizer: Centralized utility to reject absolute paths, .. patterns, and invalid characters.

    Storage Root: Enforce all writes to a designated public/generated-images directory.

    Store only relative paths in the database to maintain portability.

4. Validation

    Path traversal test cases fail safely and are logged.

    File operations cannot escape the designated base storage directory.

Implementation Notes (2026-03-02)

    Centralized path safety utility added at src/common/path-safety.util.ts with:

        sanitizeRelativePath() - rejects absolute paths, traversal segments, null bytes, and illegal characters.

        resolveWithinGeneratedImages() - resolves and enforces writes inside public/generated-images only.

        normalizeDbResultPath() - normalizes and stores result_url as a safe relative path.

    Local storage writes hardened in src/image-gen/local-storage.service.ts:

        All save/upload paths are sanitized and root-bounded before write.

    Direct strategy writes hardened:

        src/image-gen/strategies/d2-diagram.strategy.ts now resolves output directory through root-bounded path utility.

        src/image-gen/strategies/sourced-image.strategy.ts now sanitizes output dir and root-bounds artifacts directory.

    PostgreSQL persistence hardened:

        src/storage/postgres-storage.service.ts now normalizes result_url before update, preventing absolute/protocol paths from being stored.

Validation Evidence (2026-03-02)

    Build validation passed: npm run build (Nest build successful).

    Path escape attempts now fail via sanitizer before filesystem write.

8) Containerization and Service Topology (High)
1. Issue

Runtime currently depends on local process conventions; deployment topology is not formalized for horizontal scaling.
2. High-level Plan

Define a multi-service containerized deployment separating the API, Worker, Scorer, and Database.
3. Design Specifications

    docker-compose.yml Service Set:

        app-api: Handles requests and WebSocket Auth.

        app-worker: Executes generation tasks pulled from PostgreSQL.

        clip-scorer: Sidecar for semantic relevance scoring.

        postgres: Unified storage for identity and queueing.

    Implement health, readiness, and liveness checks for all services.

4. Validation

    Services boot cleanly and communicate over the internal Docker network.

    End-to-end manifest generation succeeds within the containerized stack.

9) Structured Logging and Telemetry (Medium)
1. Issue

Ad hoc logging makes root-cause analysis and performance tracking difficult in production.
2. High-level Plan

Adopt structured JSON logging and database-backed telemetry.
3. Design Specifications

    JSON Logging: Standardized fields including task_id, user_id, latency_ms, and provider_status.

    Performance Metrics: Track task success rates and generation latency by strategy in a dashboard.

4. Validation

    Logs are queryable by user_id or task_id.

    Dashboards provide real-time visibility into error rates and latency.

10) Data Retention and Storage Lifecycle (Medium)
1. Issue

Generated assets and task logs can grow unbounded, increasing storage costs and risks.
2. High-level Plan

Implement a PostgreSQL-driven retention policy and artifact cleanup.
3. Design Specifications

    Cleanup Job: Background process to delete task records and local artifacts older than 30 days.

    Archive Option: Offload critical results to S3-compatible object storage before local deletion.

4. Validation

    Cleanup jobs execute idempotently and remove artifacts according to policy.

11) CI/CD and Prompt Safety (Medium/Nice to Have)
1. Issue

Manual deployments and drifting prompt quality can lead to regressions.
2. High-level Plan

Establish CI/CD gates and version-controlled prompt templates.
3. Design Specifications

    CI Gates: Automated secret scanning, linting, and unit tests (e.g., checking "Rugby Defense" logic).

    Prompt Versioning: Maintain a changelog for prompts to enable trivial rollbacks if retrieval quality drops.

Suggested Execution Order (2 waves)
Wave 1 (Pre-Production: Data & Auth)

    Unified Schema Migration: Deploy PostgreSQL users and tasks tables.

    DB-Backed Auth: Implement API and WebSocket Auth against PostgreSQL.

    Secrets Management: Move all credentials to platform secret stores.

    Input Validation: Hard line schemas for all endpoints.

Wave 2 (Stabilization: Queue & Scaling)

    Worker Split: Separate the generation worker from the API.

    SQL-Backed Queue: Implement atomic task pulling (FOR UPDATE SKIP LOCKED).

    Rate Limits & Quotas: Enable user-based budget controls in the worker.

    Containerization: Deploy the full multi-service topology with health checks.
