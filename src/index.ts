/**
 * HeirVault SDK — public API.
 *
 * A typed TypeScript client for the HeirVault Soroban inheritance contracts on
 * Stellar. Framework-agnostic: it depends only on `@stellar/stellar-sdk` and
 * runs in Node, the browser and edge runtimes. Freighter support is an optional
 * peer dependency loaded lazily by {@link FreighterSigner}.
 *
 * @example
 * ```ts
 * import { HeirVaultClient, FreighterSigner, toBaseUnits } from "heirvault-sdk";
 *
 * const client = new HeirVaultClient({
 *   contractId: "C…",
 *   network: "testnet",
 *   signer: new FreighterSigner(),
 *   asset: { contractId: "C…", symbol: "USDC", decimals: 7 },
 * });
 *
 * const vault = await client.getVault(1n);
 * const tx = await client.deposit(1n, toBaseUnits("25", 7));
 * console.log(tx.hash, tx.status); // "success" only once confirmed
 * ```
 */

// Client
export { HeirVaultClient, createClient, createRpcServer, clampLimit } from "./client.js";
export type {
  HeirVaultClientConfig,
  AssetInfo,
  ReadOptions,
  WriteOptions,
  DepositOptions,
  VaultIdInput,
  VaultSetupStep,
  VaultSetupStepResult,
  VaultCreationResult,
} from "./client.js";

// Bindings
export { bindings, HEIRVAULT_METHODS } from "./bindings.js";
export type { HeirVaultMethod, BindingKind, MethodBinding } from "./bindings.js";

// Transaction pipeline
export {
  submitInvocation,
  submitOperation,
  trySubmitInvocation,
  trySubmitOperation,
  prepareInvocation,
  prepareOperation,
  simulateRead,
  buildInvocation,
  getAccountSequence,
  READ_ONLY_SOURCE,
} from "./transaction.js";
export type {
  TransactionPhase,
  TxSuccess,
  SubmitInvocationParams,
  SubmitOperationParams,
  SimulateReadParams,
  InvocationOutcome,
} from "./transaction.js";

// Signers
export { FreighterSigner, callbackSigner } from "./signer.js";
export type { WalletSigner, SignOptions, FreighterApi } from "./signer.js";

// Errors
export {
  HeirVaultSdkError,
  HeirVaultContractError,
  ContractNotConfiguredError,
  SignerNotConfiguredError,
  WalletRejectedError,
  SimulationError,
  TransactionFailedError,
  ConfirmationTimeoutError,
  DecodeError,
  InvalidArgumentError,
  HeirVaultErrorCode,
  HEIRVAULT_ERROR_NAMES,
  heirVaultErrorName,
  parseContractErrorCode,
  toHeirVaultError,
} from "./errors.js";

// Network
export {
  NETWORK_IDS,
  NETWORK_PASSPHRASES,
  DEFAULT_NETWORK_ID,
  isNetworkId,
  networkConfig,
  resolveNetwork,
} from "./network.js";
export type { NetworkId, NetworkConfig, NetworkConfigInput } from "./network.js";

// Amounts
export {
  toBaseUnits,
  fromBaseUnits,
  sumAmounts,
  applyBps,
  bpsToPercent,
  percentToBps,
  formatAllocation,
  totalAllocationBps,
} from "./amounts.js";

// Codec (encoding/decoding primitives, useful for custom invocations)
export {
  addressToScVal,
  symbolToScVal,
  u32ToScVal,
  u64ToScVal,
  i128ToScVal,
  boolToScVal,
  enumToScVal,
  activationModeToScVal,
  parseVaultId,
  toBigInt,
  decodeBeneficiary,
  decodeGuardian,
  decodeVaultSummary,
  decodeVaultInfo,
  decodeClaimRecord,
  decodePageMeta,
  decodeVaultPage,
  decodeBeneficiaryPage,
  decodeGuardianPage,
  decodeClaimPage,
  decodeBeneficiaryVaultPage,
  decodeDeadlines,
  decodeGuardianStatus,
  decodeVaultStatus,
  decodeActivationMode,
  decodeU64,
  decodeI128,
  decodeU32,
  decodeBool,
  secondsToIso,
} from "./codec.js";

// Domain types and contract constants
export {
  ACTIVATION_MODES,
  VAULT_STATUSES,
  BPS_DENOMINATOR,
  FULL_ALLOCATION_BPS,
  MAX_BENEFICIARIES,
  MAX_GUARDIANS,
  MAX_PAGE_LIMIT,
  MIN_CHECK_IN_PERIOD,
  MAX_CHECK_IN_PERIOD,
  MIN_GRACE_PERIOD,
  MAX_GRACE_PERIOD,
  SCHEMA_VERSION,
} from "./types.js";
export type {
  VaultId,
  TokenAmount,
  StellarAddress,
  ActivationMode,
  VaultStatus,
  Beneficiary,
  Guardian,
  Vault,
  VaultSummary,
  PageMeta,
  VaultPage,
  BeneficiaryPage,
  GuardianPage,
  ClaimRecord,
  ClaimPage,
  BeneficiaryVaultPage,
  GuardianStatus,
  Deadlines,
  CreateVaultArgs,
  CreateVaultResult,
} from "./types.js";
