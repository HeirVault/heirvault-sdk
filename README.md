# heirvault-sdk

**Typed TypeScript SDK for the HeirVault Soroban inheritance contracts on Stellar.**

HeirVault lets an owner lock SEP-41 assets into a vault, name beneficiaries with
percentage shares, and prove they are alive by checking in. If they stop, the
vault opens to their heirs after a grace period (optionally gated by an M-of-N
guardian approval), and each heir claims their share directly.

This package wraps the on-chain contract with:

* **Rigorously typed contract bindings** — every entrypoint, argument and return
  type taken from the contract's `#[contractimpl]` block.
* **A real transaction lifecycle** — simulate → prepare → authorize → submit →
  confirm → decode, with typed failures at every stage.
* **Exact integer handling** — `u64` ids and `i128` amounts are `bigint` end to
  end; no silent float conversion.
* **A replaceable wallet signer** — bring any signer; Freighter is optional.

It is framework-agnostic: it depends only on `@stellar/stellar-sdk` and runs in
Node, browsers and edge runtimes. It is consumed by
[HeirVault-app](https://github.com/HeirVault/HeirVault-app).

---

## Table of contents

- [Install](#install)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Network and contract configuration](#network-and-contract-configuration)
- [Wallet signer setup](#wallet-signer-setup)
- [Reading state](#reading-state)
- [Writing state and the transaction lifecycle](#writing-state-and-the-transaction-lifecycle)
- [Multi-step workflow and partial failures](#multi-step-workflow-and-partial-failures)
- [Amounts and integer precision](#amounts-and-integer-precision)
- [Error model](#error-model)
- [API ↔ contract method map](#api--contract-method-map)
- [Testing](#testing)
- [Testnet integration](#testnet-integration)
- [Supported operations and known limitations](#supported-operations-and-known-limitations)
- [Versioning and compatibility policy](#versioning-and-compatibility-policy)
- [Compatibility matrix](#compatibility-matrix)
- [Security notes](#security-notes)

---

## Install

```bash
npm install heirvault-sdk @stellar/stellar-sdk
```

`@stellar/stellar-sdk` (>= 13) is a runtime dependency.
`@stellar/freighter-api` is an **optional** peer dependency, only needed if you
use the bundled `FreighterSigner`; it is loaded lazily and never bundled.

The package ships dual ESM/CJS builds with type declarations:

```
dist/index.js    dist/index.cjs    dist/index.d.ts
```

## Architecture

```
src/
├── index.ts          Public API surface (single entry point)
├── client.ts         HeirVaultClient: reads, writes, setup workflow
├── bindings.ts       The contract ABI table (methods, args, decoders)
├── codec.ts          Soroban ScVal encoding + return-value decoding
├── transaction.ts    build → simulate → sign → submit → poll → decode
├── signer.ts         WalletSigner interface + optional Freighter signer
├── errors.ts         Typed error hierarchy + contract error-code table
├── types.ts          Domain types mirroring the contract's structs/enums
├── amounts.ts        Exact bigint decimal/base-unit maths
└── network.ts        Network ids, passphrases and endpoint defaults
```

`bindings.ts` is the only place that knows the contract's ABI; `codec.ts` owns
the XDR shapes; `client.ts` is the ergonomic API. A contract change is a
one-file diff to the binding table.

The sibling repositories are:

* **Contracts** — [`heirvault-contracts`](https://github.com/HeirVault/heirvault-contracts)
  (`soroban-sdk` 22, contract `HeirVault`, `SCHEMA_VERSION = 1`).
* **Frontend** — [`HeirVault-app`](https://github.com/HeirVault/HeirVault-app),
  which consumes this SDK for all blockchain interaction.

## Quick start

```ts
import {
  HeirVaultClient,
  FreighterSigner,
  toBaseUnits,
  fromBaseUnits,
} from "heirvault-sdk";

const client = new HeirVaultClient({
  contractId: "C…",                     // deployed HeirVault contract id
  network: "testnet",
  signer: new FreighterSigner(),        // optional; required for writes
  asset: { contractId: "C…", symbol: "USDC", decimals: 7 },
});

// Read
const vault = await client.getVault(1n);
console.log(vault.effectiveStatus, fromBaseUnits(vault.balance, 7));

// Write — resolves only once the ledger confirms the transaction
const tx = await client.deposit(1n, toBaseUnits("25", 7));
if (tx.status === "success") console.log("confirmed", tx.hash, "ledger", tx.ledger);
```

## Network and contract configuration

Pass a known network id or a partial override:

```ts
new HeirVaultClient({ contractId, network: "testnet" });

new HeirVaultClient({
  contractId,
  network: {
    id: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
  },
});
```

Canonical passphrases and default RPC/Horizon endpoints are built in for
`testnet`, `mainnet`, `futurenet` and `standalone` (`NETWORK_PASSPHRASES`,
`networkConfig()`). The SDK never reads `process.env` itself — configuration is
always explicit. See [`.env.example`](./.env.example) for the variables the
integration tests and example scripts expect.

## Wallet signer setup

Any object matching `WalletSigner` works — the SDK never sees a secret key:

```ts
interface WalletSigner {
  getAddress(): Promise<string>;
  signTransaction(envelopeXdr: string, options: SignOptions): Promise<string>;
}
```

Three ready-made options:

```ts
import { FreighterSigner, callbackSigner } from "heirvault-sdk";

// Freighter (optional peer dependency, loaded lazily)
const signer = new FreighterSigner();

// Wrap an existing wallet adapter / custom signer
const signer = callbackSigner(address, async (xdr) => myWallet.sign(xdr));

// Inject an already-loaded Freighter API object (tests, host apps)
const signer = new FreighterSigner(freighterApi);
```

A rejected or declined signature surfaces as `WalletRejectedError` — it is never
reported as success.

## Reading state

Reads are simulated against Soroban RPC. They cost nothing, need no signature,
and never fabricate a result — a simulation failure throws.

```ts
await client.getVault(1n);                       // full detail + derived fields
await client.getVaultStatus(1n);                 // "Active" | "GracePeriod" | …
await client.getDeadlines(1n);                   // deadline, grace end, now
await client.isClaimable(1n);
await client.getVaultsByOwner(owner, { limit: 25 });
await client.getAllVaultsByOwner(owner);         // follows the paging cursor
await client.getVaultsByBeneficiary(heir);
await client.getVaultCount();
await client.schemaVersion();
await client.getBeneficiaries(1n);
await client.getActiveBeneficiaries(1n);
await client.getTotalAllocation(1n);
await client.getGuardians(1n);
await client.getGuardianStatus(1n);
await client.getClaims(1n);
await client.getClaim(1n, heir);
await client.getUndistributedBalance(1n);
```

All integer amounts (`balance`, `entitlement`, `claimedAmount`, …) are `bigint`
and all ids are `bigint`. Page metadata includes `hasMore` / `nextOffset`, and
`limit` is clamped to the contract's `MAX_PAGE_LIMIT` (25) exactly as the
contract does.

## Writing state and the transaction lifecycle

Every write runs the same seven-step pipeline and only resolves when the ledger
confirms the exact transaction hash:

1. **Construct** the contract invocation.
2. **Simulate** it against the configured Soroban RPC endpoint.
3. **Assemble** the transaction (footprint + resource fees).
4. **Authorize** by requesting a signature from the `WalletSigner`.
5. **Submit** the signed envelope.
6. **Poll** `getTransaction` until the final status is known.
7. **Decode** the result into a typed `TxSuccess`, or throw a typed error.

```ts
const created = await client.createVault({
  owner,
  asset: assetContractId,
  activationMode: "MissedCheckIn",     // | "GuardianApproval" | "MultiCondition"
  checkInPeriodSeconds: 90 * 86_400,   // [60, 5 years]
  gracePeriodSeconds: 30 * 86_400,     // [60, 1 year]
});
created.value;  // bigint vault id from the contract's return value

await client.addBeneficiary(created.value, heirA, 6_000);
await client.addBeneficiary(created.value, heirB, 4_000);
await client.addGuardian(created.value, guardian1);
await client.setGuardianThreshold(created.value, 2);
await client.deposit(created.value, toBaseUnits("1000", 7));
await client.checkIn(created.value);
await client.guardianApprove(created.value, guardian1);
await client.activateVault(created.value);        // permissionless
await client.claim(created.value, heirA);         // returns the paid amount
await client.cancelVault(created.value);
await client.withdraw(created.value, amount);
await client.removeBeneficiary(created.value, heirA);
await client.updateBeneficiary(created.value, heirA, 5_000);
await client.removeGuardian(created.value, guardian1);
```

Track progress with `onPhase`:

```ts
await client.deposit(1n, amount, {
  onPhase: (phase) => console.log(phase),
  // "building" | "simulating" | "awaiting-signature" | "submitted"
  // | "confirming" | "success" | "failed" | "rejected" | "pending"
});
```

Use `trySubmitInvocation` / `trySubmitOperation` for a non-throwing discriminated
union, or the low-level primitives `submitOperation`, `simulateRead`,
`prepareOperation` and `buildInvocation`.

## Multi-step workflow and partial failures

**Nothing here is atomic.** Soroban permits exactly one `invokeHostFunction` per
transaction, and the contract exposes vault creation, beneficiary setup and
deposits as separate entrypoints. `createVaultWithSetup` therefore submits one
transaction per step and returns resumable state instead of pretending the batch
succeeded:

```ts
const result = await client.createVaultWithSetup(vaultArgs, [
  { type: "addBeneficiary", beneficiary: heirA, allocationBps: 6_000 },
  { type: "addBeneficiary", beneficiary: heirB, allocationBps: 4_000 },
  { type: "addGuardian", guardian: guardian1 },
  { type: "setGuardianThreshold", threshold: 1 },
  { type: "deposit", amount: toBaseUnits("1000", 7) },
]);

if (!result.completed) {
  // result.vaultId     — the vault that *was* created (safe to reuse)
  // result.steps       — each attempted step with ok/hash/error
  // result.remaining   — the steps to retry, in order
}
```

A failure of `create_vault` itself throws; a failed follow-up step is reported in
`steps` and mirrored in `remaining`, never as success.

## Amounts and integer precision

Token amounts are `i128` base units. Never do `parseFloat(amount) * 10 ** dec`:

```ts
toBaseUnits("12.5", 7);            // 125_000_000n
fromBaseUnits(125_000_000n, 7);    // "12.5"
toBaseUnits("0.0000001", 7);       // 1n
applyBps(1_000_000_001n, 3333);    // 333_300_000n  (mirrors the contract's floor)
```

`toBaseUnits` rejects an amount with more decimals than the asset supports
rather than silently truncating. All arithmetic is string/`bigint`-based and
exact beyond `Number.MAX_SAFE_INTEGER`.

## Error model

Every failure is a typed `HeirVaultSdkError`. SDK-level reasons and
contract-level reverts are distinguishable:

| Class | When |
|---|---|
| `HeirVaultContractError` | The contract reverted; carries `code` and `errorName` |
| `SimulationError` | The call would be rejected (missing contract, failed assertion, …) |
| `WalletRejectedError` | The user declined the signature request |
| `TransactionFailedError` | Submitted but reverted on-chain; carries `hash` and `code` |
| `ConfirmationTimeoutError` | Accepted but not confirmed in the polling budget (not success) |
| `SignerNotConfiguredError` | A write was attempted without a signer |
| `InvalidArgumentError` | A client-side argument is malformed |
| `DecodeError` | A return value could not be decoded |
| `ContractNotConfiguredError` | No contract id was supplied |

Contract codes mirror `errors.rs` exactly and are stable:

```ts
import { HeirVaultContractError, HeirVaultErrorCode, heirVaultErrorName } from "heirvault-sdk";

try {
  await client.activateVault(1n);
} catch (error) {
  if (error instanceof HeirVaultContractError) {
    switch (error.code) {
      case HeirVaultErrorCode.NotEligible:        // 34
      case HeirVaultErrorCode.GracePeriodActive:  // 41
      case HeirVaultErrorCode.DeadlineNotReached: // 40
    }
  }
}
```

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| `SignerNotConfiguredError` | No `signer` passed to the client (or `setSigner`). |
| `Unauthorized` (1) | The signing address is not the owner/guardian/beneficiary the call requires. |
| `NotEligible` (34) | `GuardianApproval`/`MultiCondition` vault whose threshold is unmet, or the wrong `ActivationMode` for the current clock. |
| `GracePeriodExpired` (42) | A recovery `check_in` after `grace_end`; check `getDeadlines()`. |
| `AllocationIncomplete` (14) | Activation requires active allocations to total exactly 10 000 bps. |
| `ConfirmationTimeoutError` | The transaction may still confirm later — re-check by hash before retrying. |
| `SimulationError` | Wrong contract id, wrong network, or the contract rejected the call. |

## API ↔ contract method map

| SDK method | Contract entrypoint |
|---|---|
| `createVault` | `create_vault` |
| `getVault` | `get_vault` |
| `getVaultStatus` | `get_vault_status` |
| `getDeadlines` | `get_deadlines` |
| `isClaimable` | `is_claimable` |
| `getVaultsByOwner` / `getAllVaultsByOwner` | `get_vaults_by_owner` |
| `getVaultsByBeneficiary` | `get_vaults_by_beneficiary` |
| `getVaultCount` | `get_vault_count` |
| `schemaVersion` | `schema_version` |
| `deposit` | `deposit` |
| `addBeneficiary` / `removeBeneficiary` / `updateBeneficiary` | `add_beneficiary` / `remove_beneficiary` / `update_beneficiary` |
| `getBeneficiaries` / `getActiveBeneficiaries` / `getTotalAllocation` | `get_beneficiaries` / `get_active_beneficiaries` / `get_total_allocation` |
| `addGuardian` / `removeGuardian` / `setGuardianThreshold` / `guardianApprove` | `add_guardian` / `remove_guardian` / `set_guardian_threshold` / `guardian_approve` |
| `getGuardians` / `getGuardianStatus` | `get_guardians` / `get_guardian_status` |
| `checkIn` | `check_in` |
| `activateVault` | `activate_vault` |
| `cancelVault` | `cancel_vault` |
| `withdraw` | `withdraw` |
| `claim` | `claim` |
| `getClaims` / `getClaim` / `getUndistributedBalance` | `get_claims` / `get_claim` / `get_undistributed_balance` |

## Testing

```bash
npm run typecheck     # strict TypeScript, no emit
npm run test          # unit / encoding / lifecycle tests (no network)
npm run build         # dual ESM/CJS + d.ts
npm run verify        # typecheck + test + build
```

The default suite mocks Soroban RPC but exercises the *real* pipeline (real XDR
encoding, real `assembleTransaction`, real signing with a throwaway keypair), so
it covers contract-argument encoding, return-value decoding, the full lifecycle,
wallet rejection, simulation failure, on-chain failure and confirmation timeout.

## Testnet integration

Integration tests live in `tests/integration/` and are **excluded** from
`npm test`. Copy `.env.example` and provide:

```bash
HEIRVAULT_TESTNET_CONTRACT_ID=C…   # deployed HeirVault contract
HEIRVAULT_TESTNET_ACCOUNT=G…       # funded read source
# optional, to exercise a write:
HEIRVAULT_TESTNET_SECRET=S…        # throwaway Testnet key, used in-process only
HEIRVAULT_TESTNET_ASSET=C…         # SEP-41 asset for create_vault

npm run test:integration
```

Without credentials the suite reports as skipped — this repository ships with
**no recorded Testnet transaction hashes**, so no on-chain behaviour is claimed
as verified here. See the contract repo's
[`docs/TESTNET.md`](https://github.com/HeirVault/heirvault-contracts/blob/main/docs/TESTNET.md)
for the deployment record and hashes captured by the contract team.

## Supported operations and known limitations

**Supported:** vault creation, deposits, beneficiary add/remove/update, guardian
add/remove/threshold/approve, check-in, permissionless activation, cancellation,
withdrawal, claims, and every read entrypoint — with paging, event-era status
decoding and exact integer maths.

**Deliberately not claimed / not supported:**

* The SDK does not push funds. `activate_vault` merely opens the claim phase;
  each heir claims independently. There is no batch-payout API.
* Deadlines do **not** execute transactions. A lapse in check-ins makes a vault
  *eligible*; an explicit `activate_vault` transaction is still required.
* There is no data-migration entrypoint yet (`SCHEMA_VERSION = 1`); the SDK
  reports the schema version but cannot migrate a record.
* Event decoding: the contract emits typed events, but the SDK does not yet
  provide an indexed event-subscription helper (uses `getVault` for state).
* No published npm release yet — consume via the local path or a git dependency.

## Versioning and compatibility policy

* The SDK follows semantic versioning. The major version tracks the **contract
  interface** it targets, not the SDK's own internals.
* Within a major version, SDK method names, argument shapes and error classes are
  stable; new methods and new optional fields are additive.
* A contract change that alters an entrypoint name, argument order/type or return
  type is a breaking SDK change and bumps the SDK major version.
* Contract error codes are ABI-stable and only appended to; the SDK mirrors them
  without renumbering.
* Contract, SDK and frontend are kept in step by pinning: the frontend depends on
  a specific SDK version (`file:..` locally / a git ref in CI), and the SDK's
  compatibility matrix below pins the contract interface it was generated from.

## Compatibility matrix

| SDK version | Contract source | `SCHEMA_VERSION` | `soroban-sdk` | `@stellar/stellar-sdk` | Interface notes |
|---|---|---|---|---|---|
| `0.1.x` | `heirvault-contracts` @ `14d2383` | `1` | `22.x` | `>= 13 < 14` | Full entrypoint set incl. `get_vaults_by_beneficiary` |

The SDK targets the deployed interface described above. `schemaVersion()` is the
runtime check: if the contract reports a version this SDK does not know, treat
the deployment as unsupported until the SDK is updated.

## Security notes

* The SDK **never** requests, stores, logs or transmits secret keys or recovery
  phrases. Signing is delegated to the caller's `WalletSigner`.
* A transaction is reported as successful **only** after Soroban RPC returns
  `SUCCESS` for that exact hash. A signature or an accepted submission is not
  success.
* Contract error codes are surfaced as-is so callers can branch precisely.
* Not audited. Use on Testnet first; this SDK is not a security guarantee.

## License

MIT — see [LICENSE](./LICENSE).
