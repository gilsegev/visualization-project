# Option A-prime: Phase 0 Implementation

This file tracks implementation status for **Phase 0 only** (Scope Lock and Contracts).

## Implemented

1. Contract types added:
   - `src/documents/contracts/document-job.contract.ts`
   - `DocumentJob`, `DocumentAssetTask`, `DocumentOutput`
   - Includes `docVersionHash` (`DOC_VERSION_HASH` contract field)
2. Manifest version baseline added:
   - `src/documents/contracts/document-manifest.contract.ts`
   - `DOCUMENT_MANIFEST_VERSION = 1`
3. `DOC_VERSION_HASH` generator added:
   - `src/documents/contracts/doc-version-hash.ts`
   - Deterministic SHA-256 from source object metadata
4. State machine guard added:
   - `src/documents/state/document-job-state.machine.ts`
   - Allowed transitions:
     - `queued -> analyzing -> planning -> generating_assets -> inserting -> packaging -> completed`
     - Any active state may transition to `failed`
5. Export barrel added:
   - `src/documents/index.ts`

## Validation (Phase 0 design checks)

Validation script:

- `tools/validate-document-phase0.ts`

What it verifies:

1. Manifest version is pinned to `1`
2. Valid and invalid state transitions behave as expected
3. Invalid transitions throw errors
4. `DOC_VERSION_HASH` is deterministic
5. `DOC_VERSION_HASH` changes when source metadata changes

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase0.ts
```

Expected output:

```text
[phase0-validation] PASS
```

## Scope Guard

No Phase 1+ implementation was performed in this change set.
