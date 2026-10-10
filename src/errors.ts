/**
 * Typed error model for the HeirVault SDK.
 *
 * The contract exposes a *stable numeric* error ABI (see
 * `heirvault-contracts/contracts/heirvault/src/errors.rs`): every failure mode
 * has its own code and existing codes are never renumbered. The SDK mirrors
 * that table so callers can branch on a specific reason instead of parsing a
 * host panic string.
 *
 * SDK-level failures that never reach the contract (a rejected signature, a
 * confirmation timeout, a missing configuration) get their own class hierarchy
 * so callers can distinguish "the chain said no" from "we never got that far".
 */

/** Numeric error codes returned by the HeirVault contract. */
export enum HeirVaultErrorCode {
  // ---- 1..9: authorization, lookup, asset ----
  Unauthorized = 1,
  VaultNotFound = 2,
  VaultAlreadyExists = 3,
  InvalidAsset = 4,
  InvalidAddress = 5,
  NotInitialized = 6,
  // ---- 10..19: amounts and allocation ----
  InvalidAmount = 10,
  InvalidBeneficiary = 11,
  InvalidAllocation = 12,
  AllocationExceeded = 13,
  AllocationIncomplete = 14,
  NoBeneficiaries = 15,
  TooManyBeneficiaries = 16,
  DuplicateBeneficiary = 17,
  // ---- 20..29: guardians and thresholds ----
  InvalidGuardian = 20,
  InvalidThreshold = 21,
  TooManyGuardians = 22,
  DuplicateGuardian = 23,
  AlreadyApproved = 24,
  ApprovalNotEnabled = 25,
  // ---- 30..39: lifecycle / state machine ----
  InvalidState = 30,
  VaultNotEditable = 31,
  AlreadyActivated = 32,
  NotActivated = 33,
  NotEligible = 34,
  VaultCancelled = 35,
  VaultCompleted = 36,
  // ---- 40..49: timestamps and deadlines ----
  DeadlineNotReached = 40,
  GracePeriodActive = 41,
  GracePeriodExpired = 42,
  InvalidPeriod = 43,
  // ---- 50..59: claims ----
  AlreadyClaimed = 50,
  InsufficientBalance = 51,
  // ---- 60..69: paging and arithmetic ----
  InvalidPageLimit = 60,
  ArithmeticOverflow = 61,
}

/** Human-readable names for every contract error code. */
export const HEIRVAULT_ERROR_NAMES: Readonly<Record<number, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(HeirVaultErrorCode)
      .filter(([, value]) => typeof value === "number")
      .map(([key, value]) => [value as number, key]),
  ),
);

/** Resolve a numeric code back to its stable enum name, when known. */
export function heirVaultErrorName(code: number): string {
  return HEIRVAULT_ERROR_NAMES[code] ?? `UnknownError(${code})`;
}

/** Base class for every error thrown by the SDK. */
export class HeirVaultSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * A contract-level failure: the transaction reverted with a `HeirVaultError`
 * code. `code` is the numeric ABI code, `errorName` its stable symbolic name.
 */
export class HeirVaultContractError extends HeirVaultSdkError {
  readonly code: number;
  readonly errorName: string;

  constructor(code: number, detail?: string) {
    const errorName = heirVaultErrorName(code);
    super(detail ? `${errorName} (${code}): ${detail}` : `${errorName} (${code})`);
    this.code = code;
    this.errorName = errorName;
  }
}

/** Raised before any network call when the SDK has no contract id configured. */
export class ContractNotConfiguredError extends HeirVaultSdkError {
  constructor(message = "No HeirVault contract id is configured.") {
    super(message);
  }
}

/** Raised when a write action is attempted without a configured wallet signer. */
export class SignerNotConfiguredError extends HeirVaultSdkError {
  constructor(message = "No wallet signer is configured for this SDK client.") {
    super(message);
  }
}

/** Raised when the user declines to sign in their wallet. Never a success. */
export class WalletRejectedError extends HeirVaultSdkError {
  constructor(message = "The wallet signature request was rejected.") {
    super(message);
  }
}

/**
 * Raised when simulation fails. Simulation is a dry run: this means the
 * transaction *would* be rejected (missing contract, unknown entrypoint, failed
 * contract assertion, insufficient resources).
 */
export class SimulationError extends HeirVaultSdkError {
  /** Contract error code, when the simulation error decoded to one. */
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

/**
 * Raised when a submitted transaction failed on-chain. Carries the transaction
 * hash and, when the ledger error decoded to a contract code, `code`.
 */
export class TransactionFailedError extends HeirVaultSdkError {
  readonly hash?: string;
  readonly code?: number;

  constructor(message: string, hash?: string, code?: number) {
    super(message);
    this.hash = hash;
    this.code = code;
  }
}

/**
 * Raised when a transaction was accepted but could not be confirmed within the
 * polling budget. This is explicitly **not** success — the transaction may
 * still be included in a later ledger.
 */
export class ConfirmationTimeoutError extends HeirVaultSdkError {
  readonly hash: string;

  constructor(hash: string, message = "The transaction was not confirmed before the polling budget expired.") {
    super(`${message} (hash: ${hash})`);
    this.hash = hash;
  }
}

/** Raised when a contract return value cannot be decoded into an SDK type. */
export class DecodeError extends HeirVaultSdkError {
  constructor(message: string) {
    super(message);
  }
}

/** Raised when a caller supplies an argument the contract would reject. */
export class InvalidArgumentError extends HeirVaultSdkError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Extract a `HeirVaultError` code from a Soroban/RPC error string or object.
 *
 * Soroban surfaces contract errors in several shapes depending on where the
 * failure is observed:
 *  - `"Error(Contract, #34)"` from a diagnostic event or failed simulation;
 *  - `{ type: "contract", code: 34 }` / `{ contractCode: 34 }` from a decoded
 *    `TransactionResult`;
 *  - `"HostError: Error(Contract, #34)"` in a raw simulation error string.
 *
 * Returns `undefined` when no code is present.
 */
export function parseContractErrorCode(source: unknown): number | undefined {
  if (source === null || source === undefined) return undefined;

  if (typeof source === "object") {
    const record = source as Record<string, unknown>;
    for (const key of ["contractCode", "code", "contract_code"]) {
      const value = record[key];
      if (typeof value === "number" && Number.isInteger(value)) return value;
    }
    // An Error carries the code in its message (host/simulation errors do).
    if (typeof record.message === "string") return parseContractErrorCode(record.message);
    return undefined;
  }

  const text = String(source);
  // Matches "Error(Contract, #34)", "contract error #34", "#34".
  const match = /(?:contract[^#]*#|\(Contract,\s*#|#)\s*(\d+)/i.exec(text);
  if (match?.[1]) {
    const code = Number.parseInt(match[1], 10);
    if (Number.isFinite(code)) return code;
  }
  return undefined;
}

/**
 * Turn any thrown value into a typed SDK error.
 *
 * Contract codes are promoted to {@link HeirVaultContractError}; everything else
 * keeps its message. This is what the transaction pipeline uses to guarantee
 * that a rejection, a simulation failure and a contract revert are
 * distinguishable.
 */
export function toHeirVaultError(error: unknown, fallbackMessage = "The operation failed."): HeirVaultSdkError {
  if (error instanceof HeirVaultSdkError) return error;

  const code = parseContractErrorCode(error);
  if (code !== undefined) {
    return new HeirVaultContractError(code, error instanceof Error ? error.message : String(error));
  }

  return new HeirVaultSdkError(error instanceof Error ? error.message : String(error) || fallbackMessage);
}
