/**
 * HeirVault contract bindings.
 *
 * The single place that knows the contract's entrypoint names, argument order,
 * Soroban argument types and return types. Every name, argument and return type
 * here was taken directly from the contract's `#[contractimpl]` block
 * (`heirvault-contracts/contracts/heirvault/src/lib.rs`).
 *
 * Generated artifacts belong in this file; the higher-level, ergonomic API lives
 * in `client.ts`. Keeping them apart means a contract change is a one-file
 * diff to the binding table.
 *
 * | Entrypoint | Args | Returns |
 * |---|---|---|
 * | `create_vault` | owner, asset, activation_mode, check_in_period, grace_period | `u64` |
 * | `deposit` | vault_id, asset, amount | `()` |
 * | `add_beneficiary` | vault_id, beneficiary, allocation_bps | `()` |
 * | `remove_beneficiary` | vault_id, beneficiary | `()` |
 * | `update_beneficiary` | vault_id, beneficiary, new_allocation_bps | `()` |
 * | `add_guardian` | vault_id, guardian | `()` |
 * | `remove_guardian` | vault_id, guardian | `()` |
 * | `set_guardian_threshold` | vault_id, threshold | `()` |
 * | `guardian_approve` | vault_id, guardian | `()` |
 * | `check_in` | vault_id | `u64` |
 * | `activate_vault` | vault_id | `()` |
 * | `cancel_vault` | vault_id | `()` |
 * | `withdraw` | vault_id, amount | `()` |
 * | `claim` | vault_id, beneficiary | `i128` |
 * | `get_vault` | vault_id | `VaultInfo` |
 * | `get_vault_status` | vault_id | `VaultStatus` |
 * | `get_deadlines` | vault_id | `Deadlines` |
 * | `is_claimable` | vault_id | `bool` |
 * | `get_vaults_by_owner` | owner, offset, limit | `VaultPage` |
 * | `get_vaults_by_beneficiary` | beneficiary, offset, limit | `BeneficiaryVaultPage` |
 * | `get_vault_count` | — | `u64` |
 * | `schema_version` | — | `u32` |
 * | `get_beneficiaries` | vault_id, offset, limit | `BeneficiaryPage` |
 * | `get_active_beneficiaries` | vault_id | `Vec<Beneficiary>` |
 * | `get_total_allocation` | vault_id | `u32` |
 * | `get_guardians` | vault_id, offset, limit | `GuardianPage` |
 * | `get_guardian_status` | vault_id | `GuardianStatus` |
 * | `get_claims` | vault_id, offset, limit | `ClaimPage` |
 * | `get_claim` | vault_id, beneficiary | `ClaimRecord` |
 * | `get_undistributed_balance` | vault_id | `i128` |
 */

import type { xdr } from "@stellar/stellar-sdk";

import {
  activationModeToScVal,
  addressToScVal,
  decodeActivationMode,
  decodeBeneficiary,
  decodeBeneficiaryPage,
  decodeBeneficiaryVaultPage,
  decodeBool,
  decodeClaimPage,
  decodeClaimRecord,
  decodeDeadlines,
  decodeGuardianPage,
  decodeGuardianStatus,
  decodeI128,
  decodeU32,
  decodeU64,
  decodeVaultInfo,
  decodeVaultPage,
  decodeVaultStatus,
  i128ToScVal,
  parseVaultId,
  u32ToScVal,
  u64ToScVal,
} from "./codec.js";
import type {
  ActivationMode,
  Beneficiary,
  BeneficiaryPage,
  BeneficiaryVaultPage,
  ClaimPage,
  ClaimRecord,
  CreateVaultArgs,
  Deadlines,
  GuardianPage,
  GuardianStatus,
  StellarAddress,
  TokenAmount,
  Vault,
  VaultId,
  VaultPage,
  VaultStatus,
} from "./types.js";

/** Stable contract entrypoint names. */
export const HEIRVAULT_METHODS = {
  createVault: "create_vault",
  deposit: "deposit",
  addBeneficiary: "add_beneficiary",
  removeBeneficiary: "remove_beneficiary",
  updateBeneficiary: "update_beneficiary",
  addGuardian: "add_guardian",
  removeGuardian: "remove_guardian",
  setGuardianThreshold: "set_guardian_threshold",
  guardianApprove: "guardian_approve",
  checkIn: "check_in",
  activateVault: "activate_vault",
  cancelVault: "cancel_vault",
  withdraw: "withdraw",
  claim: "claim",
  getBeneficiaries: "get_beneficiaries",
  getActiveBeneficiaries: "get_active_beneficiaries",
  getTotalAllocation: "get_total_allocation",
  getGuardians: "get_guardians",
  getGuardianStatus: "get_guardian_status",
  getClaims: "get_claims",
  getClaim: "get_claim",
  getUndistributedBalance: "get_undistributed_balance",
  getVault: "get_vault",
  getVaultStatus: "get_vault_status",
  getDeadlines: "get_deadlines",
  isClaimable: "is_claimable",
  getVaultsByOwner: "get_vaults_by_owner",
  getVaultsByBeneficiary: "get_vaults_by_beneficiary",
  getVaultCount: "get_vault_count",
  schemaVersion: "schema_version",
} as const;

export type HeirVaultMethod = (typeof HEIRVAULT_METHODS)[keyof typeof HEIRVAULT_METHODS];

// ---------------------------------------------------------------------------
// Argument encoders
// ---------------------------------------------------------------------------

export function encodeCreateVault(args: CreateVaultArgs): xdr.ScVal[] {
  return [
    addressToScVal(args.owner),
    addressToScVal(args.asset),
    activationModeToScVal(args.activationMode),
    u64ToScVal(BigInt(args.checkInPeriodSeconds)),
    u64ToScVal(BigInt(args.gracePeriodSeconds)),
  ];
}

// ---------------------------------------------------------------------------
// Binding table
// ---------------------------------------------------------------------------

/** How an entrypoint is invoked. */
export type BindingKind = "write" | "read";

export interface MethodBinding<In, Out> {
  method: HeirVaultMethod;
  kind: BindingKind;
  encode: (input: In) => xdr.ScVal[];
  decode: (native: unknown) => Out;
}

/** The complete binding table. */
export const bindings = {
  createVault: {
    method: HEIRVAULT_METHODS.createVault,
    kind: "write",
    encode: encodeCreateVault,
    decode: decodeU64,
  },
  deposit: {
    method: HEIRVAULT_METHODS.deposit,
    kind: "write",
    encode: (input: { vaultId: VaultId; asset: StellarAddress; amount: TokenAmount }): xdr.ScVal[] => [
      u64ToScVal(input.vaultId),
      addressToScVal(input.asset),
      i128ToScVal(input.amount),
    ],
    decode: () => undefined,
  },
  addBeneficiary: {
    method: HEIRVAULT_METHODS.addBeneficiary,
    kind: "write",
    encode: (input: { vaultId: VaultId; beneficiary: StellarAddress; allocationBps: number }): xdr.ScVal[] => [
      u64ToScVal(input.vaultId),
      addressToScVal(input.beneficiary),
      u32ToScVal(input.allocationBps),
    ],
    decode: () => undefined,
  },
  removeBeneficiary: {
    method: HEIRVAULT_METHODS.removeBeneficiary,
    kind: "write",
    encode: (input: { vaultId: VaultId; beneficiary: StellarAddress }): xdr.ScVal[] => [
      u64ToScVal(input.vaultId),
      addressToScVal(input.beneficiary),
    ],
    decode: () => undefined,
  },
  updateBeneficiary: {
    method: HEIRVAULT_METHODS.updateBeneficiary,
    kind: "write",
    encode: (input: { vaultId: VaultId; beneficiary: StellarAddress; newAllocationBps: number }): xdr.ScVal[] => [
      u64ToScVal(input.vaultId),
      addressToScVal(input.beneficiary),
      u32ToScVal(input.newAllocationBps),
    ],
    decode: () => undefined,
  },
  addGuardian: {
    method: HEIRVAULT_METHODS.addGuardian,
    kind: "write",
    encode: (input: { vaultId: VaultId; guardian: StellarAddress }): xdr.ScVal[] => [
      u64ToScVal(input.vaultId),
      addressToScVal(input.guardian),
    ],
    decode: () => undefined,
  },
  removeGuardian: {
    method: HEIRVAULT_METHODS.removeGuardian,
    kind: "write",
    encode: (input: { vaultId: VaultId; guardian: StellarAddress }): xdr.ScVal[] => [
      u64ToScVal(input.vaultId),
      addressToScVal(input.guardian),
    ],
    decode: () => undefined,
  },
  setGuardianThreshold: {
    method: HEIRVAULT_METHODS.setGuardianThreshold,
    kind: "write",
    encode: (input: { vaultId: VaultId; threshold: number }): xdr.ScVal[] => [
      u64ToScVal(input.vaultId),
      u32ToScVal(input.threshold),
    ],
    decode: () => undefined,
  },
  guardianApprove: {
    method: HEIRVAULT_METHODS.guardianApprove,
    kind: "write",
    encode: (input: { vaultId: VaultId; guardian: StellarAddress }): xdr.ScVal[] => [
      u64ToScVal(input.vaultId),
      addressToScVal(input.guardian),
    ],
    decode: () => undefined,
  },
  checkIn: {
    method: HEIRVAULT_METHODS.checkIn,
    kind: "write",
    encode: (input: { vaultId: VaultId }): xdr.ScVal[] => [u64ToScVal(input.vaultId)],
    decode: decodeU64,
  },
  activateVault: {
    method: HEIRVAULT_METHODS.activateVault,
    kind: "write",
    encode: (input: { vaultId: VaultId }): xdr.ScVal[] => [u64ToScVal(input.vaultId)],
    decode: () => undefined,
  },
  cancelVault: {
    method: HEIRVAULT_METHODS.cancelVault,
    kind: "write",
    encode: (input: { vaultId: VaultId }): xdr.ScVal[] => [u64ToScVal(input.vaultId)],
    decode: () => undefined,
  },
  withdraw: {
    method: HEIRVAULT_METHODS.withdraw,
    kind: "write",
    encode: (input: { vaultId: VaultId; amount: TokenAmount }): xdr.ScVal[] => [
      u64ToScVal(input.vaultId),
      i128ToScVal(input.amount),
    ],
    decode: () => undefined,
  },
  claim: {
    method: HEIRVAULT_METHODS.claim,
    kind: "write",
    encode: (input: { vaultId: VaultId; beneficiary: StellarAddress }): xdr.ScVal[] => [
      u64ToScVal(input.vaultId),
      addressToScVal(input.beneficiary),
    ],
    decode: decodeI128,
  },

  // ---- reads ----
  getVault: {
    method: HEIRVAULT_METHODS.getVault,
    kind: "read",
    encode: (input: { vaultId: VaultId }): xdr.ScVal[] => [u64ToScVal(input.vaultId)],
    decode: decodeVaultInfo,
  },
  getVaultStatus: {
    method: HEIRVAULT_METHODS.getVaultStatus,
    kind: "read",
    encode: (input: { vaultId: VaultId }): xdr.ScVal[] => [u64ToScVal(input.vaultId)],
    decode: decodeVaultStatus,
  },
  getDeadlines: {
    method: HEIRVAULT_METHODS.getDeadlines,
    kind: "read",
    encode: (input: { vaultId: VaultId }): xdr.ScVal[] => [u64ToScVal(input.vaultId)],
    decode: decodeDeadlines,
  },
  isClaimable: {
    method: HEIRVAULT_METHODS.isClaimable,
    kind: "read",
    encode: (input: { vaultId: VaultId }): xdr.ScVal[] => [u64ToScVal(input.vaultId)],
    decode: decodeBool,
  },
  getVaultsByOwner: {
    method: HEIRVAULT_METHODS.getVaultsByOwner,
    kind: "read",
    encode: (input: { owner: StellarAddress; offset: number; limit: number }): xdr.ScVal[] => [
      addressToScVal(input.owner),
      u32ToScVal(input.offset),
      u32ToScVal(input.limit),
    ],
    decode: decodeVaultPage,
  },
  getVaultsByBeneficiary: {
    method: HEIRVAULT_METHODS.getVaultsByBeneficiary,
    kind: "read",
    encode: (input: { beneficiary: StellarAddress; offset: number; limit: number }): xdr.ScVal[] => [
      addressToScVal(input.beneficiary),
      u32ToScVal(input.offset),
      u32ToScVal(input.limit),
    ],
    decode: decodeBeneficiaryVaultPage,
  },
  getVaultCount: {
    method: HEIRVAULT_METHODS.getVaultCount,
    kind: "read",
    encode: (): xdr.ScVal[] => [],
    decode: decodeU64,
  },
  schemaVersion: {
    method: HEIRVAULT_METHODS.schemaVersion,
    kind: "read",
    encode: (): xdr.ScVal[] => [],
    decode: decodeU32,
  },
  getBeneficiaries: {
    method: HEIRVAULT_METHODS.getBeneficiaries,
    kind: "read",
    encode: (input: { vaultId: VaultId; offset: number; limit: number }): xdr.ScVal[] => [
      u64ToScVal(input.vaultId),
      u32ToScVal(input.offset),
      u32ToScVal(input.limit),
    ],
    decode: decodeBeneficiaryPage,
  },
  getActiveBeneficiaries: {
    method: HEIRVAULT_METHODS.getActiveBeneficiaries,
    kind: "read",
    encode: (input: { vaultId: VaultId }): xdr.ScVal[] => [u64ToScVal(input.vaultId)],
    decode: (native: unknown): Beneficiary[] =>
      Array.isArray(native) ? native.map((entry, index) => decodeBeneficiary(entry, index)) : [],
  },
  getTotalAllocation: {
    method: HEIRVAULT_METHODS.getTotalAllocation,
    kind: "read",
    encode: (input: { vaultId: VaultId }): xdr.ScVal[] => [u64ToScVal(input.vaultId)],
    decode: decodeU32,
  },
  getGuardians: {
    method: HEIRVAULT_METHODS.getGuardians,
    kind: "read",
    encode: (input: { vaultId: VaultId; offset: number; limit: number }): xdr.ScVal[] => [
      u64ToScVal(input.vaultId),
      u32ToScVal(input.offset),
      u32ToScVal(input.limit),
    ],
    decode: decodeGuardianPage,
  },
  getGuardianStatus: {
    method: HEIRVAULT_METHODS.getGuardianStatus,
    kind: "read",
    encode: (input: { vaultId: VaultId }): xdr.ScVal[] => [u64ToScVal(input.vaultId)],
    decode: decodeGuardianStatus,
  },
  getClaims: {
    method: HEIRVAULT_METHODS.getClaims,
    kind: "read",
    encode: (input: { vaultId: VaultId; offset: number; limit: number }): xdr.ScVal[] => [
      u64ToScVal(input.vaultId),
      u32ToScVal(input.offset),
      u32ToScVal(input.limit),
    ],
    decode: decodeClaimPage,
  },
  getClaim: {
    method: HEIRVAULT_METHODS.getClaim,
    kind: "read",
    encode: (input: { vaultId: VaultId; beneficiary: StellarAddress }): xdr.ScVal[] => [
      u64ToScVal(input.vaultId),
      addressToScVal(input.beneficiary),
    ],
    decode: (native: unknown) => decodeClaimRecord(native, 0),
  },
  getUndistributedBalance: {
    method: HEIRVAULT_METHODS.getUndistributedBalance,
    kind: "read",
    encode: (input: { vaultId: VaultId }): xdr.ScVal[] => [u64ToScVal(input.vaultId)],
    decode: decodeI128,
  },
} as const;

/** Decode an `ActivationMode` returned by a read, re-exported for convenience. */
export { decodeActivationMode, parseVaultId };

/** Types re-exported so consumers can type their own dynamic calls. */
export type { Vault, VaultStatus, VaultId, VaultPage, BeneficiaryPage, GuardianPage, ClaimPage, ClaimRecord, Deadlines, GuardianStatus, BeneficiaryVaultPage, ActivationMode };
