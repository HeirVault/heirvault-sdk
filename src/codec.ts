/**
 * Soroban value codec.
 *
 * Two directions:
 *
 *  - **Encoding** turns SDK arguments into `xdr.ScVal`s using the *exact*
 *    Soroban ABI shapes the contract expects. In particular a Rust enum variant
 *    (for example `ActivationMode::MissedCheckIn`) is encoded as
 *    `ScVec[Symbol]`, **not** as a bare `Symbol` — sending a bare symbol makes
 *    the host fail while decoding the entrypoint's arguments.
 *  - **Decoding** maps the native value returned by `scValToNative` into the
 *    SDK's typed domain objects. Every integer that can exceed
 *    `Number.MAX_SAFE_INTEGER` (`u64`, `i128`) is read as a `bigint`.
 *
 * Field names used by the decoder match the contract's Rust struct fields
 * (snake_case), which is what Soroban encodes into an `ScMap`.
 */

import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

import { DecodeError } from "./errors.js";
import {
  ACTIVATION_MODES,
  VAULT_STATUSES,
  type ActivationMode,
  type Beneficiary,
  type BeneficiaryPage,
  type BeneficiaryVaultPage,
  type ClaimPage,
  type ClaimRecord,
  type Deadlines,
  type Guardian,
  type GuardianPage,
  type GuardianStatus,
  type PageMeta,
  type TokenAmount,
  type Vault,
  type VaultId,
  type VaultPage,
  type VaultStatus,
  type VaultSummary,
} from "./types.js";

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** Encode a `G…`/`C…` address as an `Address` ScVal. */
export function addressToScVal(address: string): xdr.ScVal {
  return new Address(address).toScVal();
}

/** Encode a Rust `Symbol`. */
export function symbolToScVal(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "symbol" });
}

/** Encode a `u32`. */
export function u32ToScVal(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}

/** Encode a `u64` from a `bigint` (never a `number`). */
export function u64ToScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u64" });
}

/** Encode an `i128` from a `bigint`. */
export function i128ToScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

/** Encode a `bool`. */
export function boolToScVal(value: boolean): xdr.ScVal {
  return nativeToScVal(value, { type: "bool" });
}

/**
 * Encode a unit Rust enum variant as `ScVec[Symbol]`.
 *
 * Soroban encodes a `#[contracttype] enum` variant with no payload as a
 * one-element vector holding the variant name as a symbol.
 */
export function enumToScVal(variant: string): xdr.ScVal {
  return xdr.ScVal.scvVec([symbolToScVal(variant)]);
}

/** Encode an `ActivationMode`. */
export function activationModeToScVal(mode: ActivationMode): xdr.ScVal {
  return enumToScVal(mode);
}

/**
 * Parse a vault id from a decimal string or number.
 *
 * Accepts the forms a UI naturally holds (`"12"`, `12`) and rejects anything
 * that is not a non-negative integer, so a malformed id never reaches the
 * network.
 */
export function parseVaultId(value: string | number | bigint): VaultId {
  if (typeof value === "bigint") {
    if (value < 0n) throw new DecodeError(`Vault id must be non-negative, received ${value}.`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new DecodeError(`Vault id must be a non-negative integer, received ${value}.`);
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new DecodeError(`Vault id must be a non-negative integer, received "${value}".`);
  }
  return BigInt(trimmed);
}

// ---------------------------------------------------------------------------
// Decoding primitives
// ---------------------------------------------------------------------------

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array)) {
    return value as Record<string, unknown>;
  }
  throw new DecodeError(`Expected ${label} to be a struct, received ${describe(value)}.`);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value;
}

function readString(source: Record<string, unknown>, key: string, label: string): string {
  const value = source[key];
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new DecodeError(`Expected ${label}.${key} to be a non-empty string.`);
}

function readNumber(source: Record<string, unknown>, key: string, label: string): number {
  const value = source[key];
  const parsed =
    typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new DecodeError(`Expected ${label}.${key} to be an integer.`);
  }
  return parsed;
}

function readBigInt(source: Record<string, unknown>, key: string, label: string): bigint {
  const value = source[key];
  return toBigInt(value, `${label}.${key}`);
}

/** Coerce a decoded integer (bigint, number or decimal string) to a bigint. */
export function toBigInt(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  throw new DecodeError(`Expected ${label} to be an integer, received ${describe(value)}.`);
}

function readBool(source: Record<string, unknown>, key: string, label: string): boolean {
  const value = source[key];
  if (typeof value === "boolean") return value;
  throw new DecodeError(`Expected ${label}.${key} to be a boolean, received ${describe(value)}.`);
}

/**
 * Read a unit Rust enum variant.
 *
 * `scValToNative` decodes `ScVec[Symbol]` into `["Variant"]`; a bare symbol
 * string is accepted too so the decoder tolerates either host behaviour.
 */
function readVariant(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") return value[0] as string;
  throw new DecodeError(`Expected ${label} to be an enum variant, received ${describe(value)}.`);
}

/** Decode a vault status, rejecting unknown variants. */
export function decodeVaultStatus(value: unknown): VaultStatus {
  const variant = readVariant(value, "status");
  if ((VAULT_STATUSES as readonly string[]).includes(variant)) return variant as VaultStatus;
  throw new DecodeError(`Unknown vault status ${JSON.stringify(variant)}.`);
}

/** Decode an activation mode, rejecting unknown variants. */
export function decodeActivationMode(value: unknown): ActivationMode {
  const variant = readVariant(value, "activation_mode");
  if ((ACTIVATION_MODES as readonly string[]).includes(variant)) return variant as ActivationMode;
  throw new DecodeError(`Unknown activation mode ${JSON.stringify(variant)}.`);
}

/**
 * Convert a u64 unix-seconds value into an ISO-8601 string.
 *
 * Returns `null` for `0`, which the contract uses as "not set" (for example
 * `activated_at` on an unactivated vault).
 */
export function secondsToIso(value: unknown): string | null {
  let seconds: number | undefined;
  if (typeof value === "bigint") seconds = Number(value);
  else if (typeof value === "number") seconds = value;
  else if (typeof value === "string" && /^\d+$/.test(value)) seconds = Number(value);
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function requireIso(value: unknown, label: string): string {
  const iso = secondsToIso(value);
  if (!iso) throw new DecodeError(`Expected ${label} to be a positive timestamp.`);
  return iso;
}

// ---------------------------------------------------------------------------
// Struct decoding
// ---------------------------------------------------------------------------

/** Decode a `Beneficiary` struct. */
export function decodeBeneficiary(value: unknown, index = 0): Beneficiary {
  const label = `beneficiary[${index}]`;
  const record = asRecord(value, label);
  return {
    address: readString(record, "address", label),
    allocationBps: readNumber(record, "allocation_bps", label),
    active: record.active === true,
    claimed: record.claimed === true,
    claimedAmount: readBigInt(record, "claimed_amount", label),
  };
}

/** Decode a `Guardian` struct. */
export function decodeGuardian(value: unknown, index = 0): Guardian {
  const label = `guardian[${index}]`;
  const record = asRecord(value, label);
  return {
    address: readString(record, "address", label),
    active: record.active === true,
    approved: record.approved === true,
  };
}

/** Decode a `VaultSummary`. */
export function decodeVaultSummary(value: unknown, index = 0): VaultSummary {
  const label = `vault_summary[${index}]`;
  const record = asRecord(value, label);
  return {
    id: readBigInt(record, "id", label),
    owner: readString(record, "owner", label),
    asset: readString(record, "asset", label),
    balance: readBigInt(record, "balance", label),
    status: decodeVaultStatus(record.status),
    activationMode: decodeActivationMode(record.activation_mode),
    checkInPeriodSeconds: readNumber(record, "check_in_period", label),
    gracePeriodSeconds: readNumber(record, "grace_period", label),
    lastCheckInSeconds: readNumber(record, "last_check_in", label),
    deadlineSeconds: readNumber(record, "deadline", label),
    graceEndSeconds: readNumber(record, "grace_end", label),
    beneficiaryCount: readNumber(record, "beneficiary_count", label),
    guardianCount: readNumber(record, "guardian_count", label),
    totalAllocationBps: readNumber(record, "total_allocation_bps", label),
    schemaVersion: readNumber(record, "schema_version", label),
  };
}

/** Decode the raw `Vault` record (used internally before derived fields are merged). */
function decodeRawVault(value: unknown): Record<string, unknown> {
  const record = asRecord(value, "vault_info.vault");
  // Validate the required scalar fields up front so a malformed record fails
  // with a precise message rather than an unrelated downstream error.
  readBigInt(record, "id", "vault_info.vault");
  readString(record, "owner", "vault_info.vault");
  readString(record, "asset", "vault_info.vault");
  return record;
}

/**
 * Decode a full `VaultInfo` result from `get_vault` into a flattened
 * {@link Vault}, merging the stored record with the contract's derived fields.
 */
export function decodeVaultInfo(value: unknown): Vault {
  const outer = asRecord(value, "vault_info");
  const record = decodeRawVault(outer.vault);
  const label = "vault_info.vault";

  const beneficiaries = Array.isArray(record.beneficiaries)
    ? record.beneficiaries.map((entry, index) => decodeBeneficiary(entry, index))
    : [];
  const guardians = Array.isArray(record.guardians)
    ? record.guardians.map((entry, index) => decodeGuardian(entry, index))
    : [];

  return {
    id: readBigInt(record, "id", label),
    owner: readString(record, "owner", label),
    asset: readString(record, "asset", label),
    balance: readBigInt(record, "balance", label),
    status: decodeVaultStatus(record.status),
    activationMode: decodeActivationMode(record.activation_mode),
    checkInPeriodSeconds: readNumber(record, "check_in_period", label),
    gracePeriodSeconds: readNumber(record, "grace_period", label),
    lastCheckInSeconds: readNumber(record, "last_check_in", label),
    lastStatusChangeSeconds: readNumber(record, "last_status_change", label),
    activatedAtSeconds: readNumber(record, "activated_at", label),
    distributionBalance: readBigInt(record, "distribution_balance", label),
    totalClaimed: readBigInt(record, "total_claimed", label),
    claimedCount: readNumber(record, "claimed_count", label),
    beneficiaries,
    guardians,
    guardianThreshold: readNumber(record, "guardian_threshold", label),
    guardianApprovals: readNumber(record, "guardian_approvals", label),
    createdAtSeconds: readNumber(record, "created_at", label),
    schemaVersion: readNumber(record, "schema_version", label),
    deadlineSeconds: readNumber(outer, "deadline", "vault_info"),
    graceEndSeconds: readNumber(outer, "grace_end", "vault_info"),
    effectiveStatus: decodeVaultStatus(outer.effective_status),
    totalAllocationBps: readNumber(outer, "total_allocation_bps", "vault_info"),
    activationReady: outer.activation_ready === true,
    lastCheckInAt: requireIso(record.last_check_in, `${label}.last_check_in`),
    lastStatusChangeAt: requireIso(record.last_status_change, `${label}.last_status_change`),
    activatedAt: secondsToIso(record.activated_at),
    createdAt: requireIso(record.created_at, `${label}.created_at`),
    deadline: requireIso(outer.deadline, "vault_info.deadline"),
    graceEnd: requireIso(outer.grace_end, "vault_info.grace_end"),
  };
}

/** Decode a `ClaimRecord`. */
export function decodeClaimRecord(value: unknown, index = 0): ClaimRecord {
  const label = `claim[${index}]`;
  const record = asRecord(value, label);
  return {
    beneficiary: readString(record, "beneficiary", label),
    allocationBps: readNumber(record, "allocation_bps", label),
    entitlement: readBigInt(record, "entitlement", label),
    claimedAmount: readBigInt(record, "claimed_amount", label),
    claimed: record.claimed === true,
  };
}

/** Decode a `PageMeta`. */
export function decodePageMeta(value: unknown, label = "page.meta"): PageMeta {
  const record = asRecord(value, label);
  const next = record.next_offset;
  return {
    total: readNumber(record, "total", label),
    offset: readNumber(record, "offset", label),
    limit: readNumber(record, "limit", label),
    hasMore: record.has_more === true,
    nextOffset:
      typeof next === "number"
        ? next
        : typeof next === "bigint"
          ? Number(next)
          : null,
  };
}

/** Decode a `VaultPage`. */
export function decodeVaultPage(value: unknown): VaultPage {
  const record = asRecord(value, "vault_page");
  if (!Array.isArray(record.items)) throw new DecodeError("Expected vault_page.items to be a list.");
  return {
    items: record.items.map((entry, index) => decodeVaultSummary(entry, index)),
    meta: decodePageMeta(record.meta, "vault_page.meta"),
  };
}

/** Decode a `BeneficiaryPage`. */
export function decodeBeneficiaryPage(value: unknown): BeneficiaryPage {
  const record = asRecord(value, "beneficiary_page");
  if (!Array.isArray(record.items)) throw new DecodeError("Expected beneficiary_page.items to be a list.");
  return {
    items: record.items.map((entry, index) => decodeBeneficiary(entry, index)),
    meta: decodePageMeta(record.meta, "beneficiary_page.meta"),
  };
}

/** Decode a `GuardianPage`. */
export function decodeGuardianPage(value: unknown): GuardianPage {
  const record = asRecord(value, "guardian_page");
  if (!Array.isArray(record.items)) throw new DecodeError("Expected guardian_page.items to be a list.");
  return {
    items: record.items.map((entry, index) => decodeGuardian(entry, index)),
    meta: decodePageMeta(record.meta, "guardian_page.meta"),
  };
}

/** Decode a `ClaimPage`. */
export function decodeClaimPage(value: unknown): ClaimPage {
  const record = asRecord(value, "claim_page");
  if (!Array.isArray(record.items)) throw new DecodeError("Expected claim_page.items to be a list.");
  return {
    items: record.items.map((entry, index) => decodeClaimRecord(entry, index)),
    meta: decodePageMeta(record.meta, "claim_page.meta"),
  };
}

/** Decode a `BeneficiaryVaultPage`. */
export function decodeBeneficiaryVaultPage(value: unknown): BeneficiaryVaultPage {
  const record = asRecord(value, "beneficiary_vault_page");
  const ids = record.vault_ids;
  if (ids !== undefined && ids !== null && !Array.isArray(ids)) {
    throw new DecodeError("Expected beneficiary_vault_page.vault_ids to be a list.");
  }
  return {
    vaultIds: ((ids as unknown[] | undefined) ?? []).map((id) =>
      toBigInt(id, "beneficiary_vault_page.vault_ids"),
    ),
    meta: decodePageMeta(record.meta, "beneficiary_vault_page.meta"),
  };
}

/** Decode a `Deadlines` result. */
export function decodeDeadlines(value: unknown): Deadlines {
  const record = asRecord(value, "deadlines");
  return {
    deadlineSeconds: readNumber(record, "deadline", "deadlines"),
    graceEndSeconds: readNumber(record, "grace_end", "deadlines"),
    nowSeconds: readNumber(record, "now", "deadlines"),
    deadline: requireIso(record.deadline, "deadlines.deadline"),
    graceEnd: requireIso(record.grace_end, "deadlines.grace_end"),
    now: requireIso(record.now, "deadlines.now"),
  };
}

/** Decode a `GuardianStatus` result. */
export function decodeGuardianStatus(value: unknown): GuardianStatus {
  const record = asRecord(value, "guardian_status");
  return {
    approvals: readNumber(record, "approvals", "guardian_status"),
    threshold: readNumber(record, "threshold", "guardian_status"),
    guardianCount: readNumber(record, "guardian_count", "guardian_status"),
    thresholdMet: record.threshold_met === true,
  };
}

/** Decode a `u64` scalar return value (for example `create_vault`). */
export function decodeU64(value: unknown): VaultId {
  return toBigInt(value, "u64");
}

/** Decode an `i128` scalar return value (for example `claim`). */
export function decodeI128(value: unknown): TokenAmount {
  return toBigInt(value, "i128");
}

/** Decode a `u32` scalar return value. */
export function decodeU32(value: unknown): number {
  return Number(toBigInt(value, "u32"));
}

/** Decode a `bool` scalar return value. */
export function decodeBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  throw new DecodeError(`Expected a boolean, received ${describe(value)}.`);
}
