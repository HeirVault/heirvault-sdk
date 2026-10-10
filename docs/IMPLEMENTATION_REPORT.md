# HeirVault SDK — implementation report

Scope: complete and integrate the `heirvault-sdk` package against the real
HeirVault Soroban contract and the HeirVault frontend.

> **Evidence status at the bottom of this document distinguishes work that was
> run and passed from work that could not be verified in this environment.**

## 1. Sources inspected (source of truth)

| Repository | Commit | Role |
|---|---|---|
| `HeirVault/heirvault-contracts` | `14d2383` (the SDK repo's pinned gitlink) | Contract ABI, errors, events, docs |
| `HeirVault/HeirVault-app` | `4501d6c` (the SDK repo's pinned gitlink) | Existing frontend contract layer |

The contract ABI was read from
`contracts/heirvault/src/{lib,vault,beneficiaries,guardians,claims,storage,types,errors,events}.rs`.
Every method name, argument order, Soroban type, return type, authorization
requirement and error code in the SDK was taken from those files — none were
invented.

## 2. SDK architecture (this repository)

`src/`

- `bindings.ts` — the contract ABI table (method names, argument encoders,
  return decoders, read/write classification).
- `codec.ts` — Soroban `ScVal` encoding and native-value decoding, including the
  Rust-enum-as-`ScVec[Symbol]` shape and `bigint` handling for `u64`/`i128`.
- `transaction.ts` — build → simulate → assemble → sign → submit → poll →
  decode, with `submitOperation`, `submitInvocation`, `simulateRead`,
  `prepareOperation`, `trySubmit*`.
- `client.ts` — `HeirVaultClient` (reads, writes, resumable setup workflow).
- `signer.ts` — `WalletSigner` interface, optional `FreighterSigner`,
  `callbackSigner`.
- `errors.ts` — typed error hierarchy and the exact contract error-code table.
- `types.ts`, `amounts.ts`, `network.ts` — domain types, exact integer maths,
  network configuration.
- `index.ts` — public API.

## 3. Public SDK methods

**Reads:** `getVault`, `getVaultStatus`, `getDeadlines`, `isClaimable`,
`getVaultsByOwner`, `getAllVaultsByOwner`, `getVaultsByBeneficiary`,
`getVaultCount`, `schemaVersion`, `getBeneficiaries`, `getActiveBeneficiaries`,
`getTotalAllocation`, `getGuardians`, `getGuardianStatus`, `getClaims`,
`getClaim`, `getUndistributedBalance`.

**Writes:** `createVault`, `deposit`, `addBeneficiary`, `removeBeneficiary`,
`updateBeneficiary`, `addGuardian`, `removeGuardian`, `setGuardianThreshold`,
`guardianApprove`, `checkIn`, `activateVault`, `cancelVault`, `withdraw`,
`claim`.

**Workflow:** `createVaultWithSetup` (resumable, per-step results).

**Primitives:** `submitOperation`, `submitInvocation`, `simulateRead`,
`prepareOperation`, `trySubmitInvocation`, `trySubmitOperation`,
`buildInvocation`.

See the README's [API ↔ contract method map](../README.md#api--contract-method-map)
for the one-to-one mapping.

## 4. Frontend changes (`HeirVault-app/`)

The app was materialised from its pinned commit and rewired onto the SDK:

| File | Change |
|---|---|
| `package.json` | Added `"heirvault-sdk": "file:.."`. |
| `src/lib/sdk/heirvault.ts` (new) | Builds `HeirVaultClient` from app env config and the connected wallet; re-exports SDK helpers. |
| `src/lib/stellar/contract.ts` | ABI encoding (`addressScVal`, `u32/u64/i128ScVal`, `symbolScVal`, `activationModeScVal`, `parseVaultId`) and read simulation now delegate to the SDK. Local decoders remain as the app's domain/Presentation mapping. |
| `src/hooks/useVault.ts` | Write path now runs the SDK lifecycle (`submitOperation`), one operation per transaction; SDK phases/errors mapped to the app's UI state. |
| `src/lib/stellar/transactions.ts` | Reduced to the UI transaction-state vocabulary; the local build/prepare/submit pipeline was removed. |
| `src/lib/stellar/testnet-e2e.test.ts` | Rewired to the SDK pipeline and to one operation per transaction. |
| `src/lib/stellar/contract-abi.test.ts` | Vault-id error-message assertion updated to the SDK's message. |

### Bug found and fixed

The frontend batched multiple `invokeHostFunction` operations into a single
transaction during deploy (beneficiaries + guardians + threshold). Soroban
permits **exactly one** `invokeHostFunction` per transaction, so
`assembleTransaction` would have thrown for any vault with more than one
configuration step. The SDK's per-operation submission (and the updated e2e
test) removes this invalid shape.

## 5. Verification results

All commands below were run in this environment.

### SDK (`heirvault-sdk`)

| Command | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`, strict) | **Pass** |
| `npm test` (`vitest run`) | **Pass — 67 tests, 6 files** |
| `npm run build` (`tsup`, ESM + CJS + d.ts) | **Pass** |
| `npm run verify` | **Pass** |

Test coverage: argument encoding/order for every entrypoint, enum `ScVec[Symbol]`
shape, return-value decoding for every struct, `u64`/`i128` precision beyond
`Number.MAX_SAFE_INTEGER`, amount conversion, error-code parsing, the full
transaction lifecycle (success, simulation failure, rejected signature, on-chain
failure, confirmation timeout), write source-address resolution, and the
resumable `createVaultWithSetup` partial-failure path.

### Frontend (`HeirVault-app`)

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass** |
| `npm run lint` (`eslint`) | **Pass** |
| `npm test` (`vitest run`) | **Pass — 176 tests, 3 skipped** |
| `npm run build` (`next build`) | **Pass** (8 routes generated) |

The Next.js build resolves the SDK from `dist/` (dual ESM/CJS). The only build
warnings are pre-existing `require-addon`/`sodium-native` transitive-dependency
warnings from `@stellar/stellar-sdk`, unrelated to this change.

## 6. Verified vs unverified

**Implemented and tested (automated, in this environment):**
the SDK's ABI encoding/decoding, integer precision, error mapping, transaction
lifecycle and stateful client behaviour; the frontend's typecheck, lint, unit
tests and production build against the SDK.

**Implemented but not verified in this environment:**

- **Real Testnet transactions.** `tests/integration/testnet.test.ts` is written
  and type-checked, but no contract id, funded account or secret was available,
  so it reported **skipped**. **No Testnet transaction hashes are claimed.** Do
  not treat the SDK as Testnet-verified until that suite is run with real
  credentials.
- **Real wallet signing.** The lifecycle is exercised with a throwaway in-memory
  keypair; Freighter itself was not driven in a browser.
- **On-chain confirmation timing** against the live network (`pollTransaction`
  budget behaviour) — mocked only.

## 7. Remaining work (prioritised)

1. **Run the Testnet integration suite** with real credentials; record and
   publish confirmed transaction hashes per operation.
2. **Publish the package** to npm (or a git tag) and have the frontend depend on
   a versioned release instead of `file:..`.
3. **Event decoding/subscription helper** — the contract emits typed events; the
   SDK currently relies on `getVault` for state.
4. **Schema-migration support** when the contract bumps `SCHEMA_VERSION`.
5. **Frontend e2e restoration** — run `HEIRVAULT_E2E=1` and confirm the rewired
   lifecycle against Testnet.
6. **Security review** — the SDK is unaudited. Treat contract error surfaces and
   the optional Freighter path to review.
