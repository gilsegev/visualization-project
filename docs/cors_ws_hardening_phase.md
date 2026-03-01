# Phase Implementation: CORS and WebSocket Access Hardening (Critical)

## Scope Implemented
Implemented only **Section 3: CORS and WebSocket Access Hardening** from `docs/production_readiness_plan.md`.

## What Was Added
1. Origin allowlist utility:
- `src/security/origin-allowlist.ts`
  - `parseAllowedOrigins(...)`
  - `isAllowedOrigin(...)`

2. HTTP CORS hardening:
- `src/main.ts`
  - Enables CORS with strict runtime allowlist from `ALLOWED_ORIGINS`.
  - Rejects non-allowlisted origins.

3. WebSocket origin hardening:
- `src/observability/observability.gateway.ts`
  - Removed wildcard WebSocket CORS config.
  - Validates socket handshake origin against `ALLOWED_ORIGINS`.
  - Rejects disallowed origins immediately with `auth_error` + disconnect.

4. Config surface:
- `.env.example`
  - Added `ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000`

## Design Notes
- Allowlist is shared by HTTP and WS via one utility.
- Non-browser calls with no `Origin` header are allowed by design.
- WebSocket auth (API key validation) remains in place and now runs only after origin validation passes.

## Validation Performed
1. Build validation:
- `npm run build` passes.

2. Behavior validation:
- HTTP and WS now read from the same allowlist.
- WS wildcard origin acceptance is removed.

## How To Configure
Set in `.env`:
```env
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```
For deployed environments, replace with your exact UI origins.
