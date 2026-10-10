/**
 * SDK domain types.
 *
 * These mirror the HeirVault contract's `#[contracttype]` structs and enums
 * one-to-one (see `heirvault-contracts/contracts/heirvault/src/types.rs`). The
 * intention is that there is no translation layer between what the chain stores
 * and what a caller sees: field names here match the contract where it matters,
 * and integers that can exceed `Number.MAX_SAFE_INTEGER` are always `bigint`.
 *
 * ## Integer discipline
 *
 * * Vault ids are `u64` → {@link VaultId} = `bigint`.
 * * Token amounts and balances are `i128` → `bigint`.
 * * Basis points, counts and page metadata are `u32` → `number` (bounded by the
 *   contract, so a JS number is exact).
 * * Timestamps are `u64` seconds → exposed as both `bigint` (`*Seconds`) and an
 *   ISO-8601 string for display.
 */

/** A `u64` vault identifier. `0n` is never a valid vault id. */
export type VaultId = bigint;

/** An `i128` token amount in an asset's base units. */
export type TokenAmount = bigint;

/** A Stellar account (`G…`) or contract (`C…`) address. */
export type StellarAddress = string;

/** Which rules release a vault. Mirrors the contract's `ActivationMode`. */
export type ActivationMode = "MissedCheckIn" | "GuardianApproval" | "MultiCondition";

/** The stored lifecycle state. Mirrors the contract's `VaultStatus`. */
export type VaultStatus = "Active" | "GracePeriod" | "Activated" | "Cancelled" | "Completed";

/** All activation modes, in contract declaration order. */
export const ACTIVATION_MODES: readonly ActivationMode[] = ["MissedCheckIn", "GuardianApproval", "MultiCondition"] as const;

/** All vault statuses, in contract declaration order. */
export const VAULT_STATUSES: readonly VaultStatus[] = [
  "Active",
  "GracePeriod",
  "Activated",
  "Cancelled",
  "Completed",
] as const;

/** `10_000` basis points == 100%. Mirrors `BPS_DENOMINATOR`. */
export const BPS_DENOMINATOR = 10_000;

/** Exact allocation required at activation. Mirrors `FULL_ALLOCATION_BPS`. */
export const FULL_ALLOCATION_BPS = 10_000;

/** Maximum beneficiaries per vault. Mirrors `MAX_BENEFICIARIES`. */
export const MAX_BENEFICIARIES = 10;

/** Maximum guardians per vault. Mirrors `MAX_GUARDIANS`. */
export const MAX_GUARDIANS = 5;

/** Maximum page size the contract will return. Mirrors `MAX_PAGE_LIMIT`. */
export const MAX_PAGE_LIMIT = 25;

/** Minimum check-in period in seconds. Mirrors `MIN_CHECK_IN_PERIOD`. */
export const MIN_CHECK_IN_PERIOD = 60;

/** Maximum check-in period in seconds (5 years). Mirrors `MAX_CHECK_IN_PERIOD`. */
export const MAX_CHECK_IN_PERIOD = 5 * 365 * 24 * 60 * 60;

/** Minimum grace period in seconds. Mirrors `MIN_GRACE_PERIOD`. */
export const MIN_GRACE_PERIOD = 60;

/** Maximum grace period in seconds (1 year). Mirrors `MAX_GRACE_PERIOD`. */
export const MAX_GRACE_PERIOD = 365 * 24 * 60 * 60;

/** Stored layout version stamped into every vault. Mirrors `SCHEMA_VERSION`. */
export const SCHEMA_VERSION = 1;

/** A single beneficial owner's slot in a vault. */
export interface Beneficiary {
  /** Heir's Stellar account or contract address. */
  address: StellarAddress;
  /** Share of the distribution balance, in basis points. */
  allocationBps: number;
  /** `false` once removed by the owner (the slot is retained for history). */
  active: boolean;
  /** `true` once this heir has claimed its allocation. */
  claimed: boolean;
  /** Total amount this heir has actually received. */
  claimedAmount: TokenAmount;
}

/** A guardian slot plus its vote on the current activation attempt. */
export interface Guardian {
  address: StellarAddress;
  /** `false` once removed by the owner. */
  active: boolean;
  /** Vote on the current activation attempt; cleared by every owner check-in. */
  approved: boolean;
}

/** The complete stored state of one vault, as returned by `get_vault`. */
export interface Vault {
  id: VaultId;
  owner: StellarAddress;
  /** SEP-41 token contract this vault accepts and distributes. */
  asset: StellarAddress;
  /** Internally tracked amount of `asset` held on this vault's behalf. */
  balance: TokenAmount;
  status: VaultStatus;
  activationMode: ActivationMode;
  checkInPeriodSeconds: number;
  gracePeriodSeconds: number;
  /** Ledger timestamp of the most recent successful check-in. */
  lastCheckInSeconds: number;
  lastStatusChangeSeconds: number;
  /** `0` while unactivated. */
  activatedAtSeconds: number;
  /** Balance snapshot taken at activation; claim maths uses this value. */
  distributionBalance: TokenAmount;
  totalClaimed: TokenAmount;
  claimedCount: number;
  beneficiaries: Beneficiary[];
  guardians: Guardian[];
  guardianThreshold: number;
  guardianApprovals: number;
  createdAtSeconds: number;
  schemaVersion: number;
  // ---- convenience, derived from the raw record ----
  /** `lastCheckInSeconds + checkInPeriodSeconds`. */
  deadlineSeconds: number;
  /** `deadlineSeconds + gracePeriodSeconds`. */
  graceEndSeconds: number;
  /** Clock-adjusted status (may be one step ahead of `status`). */
  effectiveStatus: VaultStatus;
  totalAllocationBps: number;
  /** `true` when the vault can be activated at the current ledger time. */
  activationReady: boolean;
  lastCheckInAt: string;
  lastStatusChangeAt: string;
  activatedAt: string | null;
  createdAt: string;
  deadline: string;
  graceEnd: string;
}

/** Compact projection used by list endpoints. */
export interface VaultSummary {
  id: VaultId;
  owner: StellarAddress;
  asset: StellarAddress;
  balance: TokenAmount;
  status: VaultStatus;
  activationMode: ActivationMode;
  checkInPeriodSeconds: number;
  gracePeriodSeconds: number;
  lastCheckInSeconds: number;
  deadlineSeconds: number;
  graceEndSeconds: number;
  beneficiaryCount: number;
  guardianCount: number;
  totalAllocationBps: number;
  schemaVersion: number;
}

/** Paging metadata shared by every list endpoint. */
export interface PageMeta {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

/** A page of {@link VaultSummary} records. */
export interface VaultPage {
  items: VaultSummary[];
  meta: PageMeta;
}

/** A page of beneficiary slots (includes deactivated ones). */
export interface BeneficiaryPage {
  items: Beneficiary[];
  meta: PageMeta;
}

/** A page of guardian slots (includes deactivated ones). */
export interface GuardianPage {
  items: Guardian[];
  meta: PageMeta;
}

/** One heir's claim position. */
export interface ClaimRecord {
  beneficiary: StellarAddress;
  allocationBps: number;
  /** Share of the distribution balance before rounding. */
  entitlement: TokenAmount;
  claimedAmount: TokenAmount;
  claimed: boolean;
}

/** A page of claim positions. */
export interface ClaimPage {
  items: ClaimRecord[];
  meta: PageMeta;
}

/** A page of vault ids in which a beneficiary is or was enrolled. */
export interface BeneficiaryVaultPage {
  vaultIds: VaultId[];
  meta: PageMeta;
}

/** Live guardian-approval position for one vault. */
export interface GuardianStatus {
  approvals: number;
  threshold: number;
  guardianCount: number;
  thresholdMet: boolean;
}

/** The two lifecycle timestamps plus the current ledger time. */
export interface Deadlines {
  deadlineSeconds: number;
  graceEndSeconds: number;
  nowSeconds: number;
  deadline: string;
  graceEnd: string;
  now: string;
}

/** Arguments to `create_vault`. */
export interface CreateVaultArgs {
  owner: StellarAddress;
  /** SEP-41 token contract id. */
  asset: StellarAddress;
  activationMode: ActivationMode;
  /** Seconds between check-ins. `60 <= value <= 5 years`. */
  checkInPeriodSeconds: number;
  /** Recovery window after the deadline. `60 <= value <= 1 year`. */
  gracePeriodSeconds: number;
}

/** Result of decoding a `create_vault` transaction. */
export interface CreateVaultResult {
  vaultId: VaultId;
}
