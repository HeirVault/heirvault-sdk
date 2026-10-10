/**
 * Soroban transaction and read primitives.
 *
 * The lifecycle for a state-changing call:
 *
 *   1. construct the contract invocation;
 *   2. simulate it against the configured Soroban RPC endpoint;
 *   3. assemble the transaction (footprint + resource fees);
 *   4. request a signature through the configured {@link WalletSigner};
 *   5. submit the signed envelope;
 *   6. poll for the final ledger status;
 *   7. decode the result into a typed success or a typed failure.
 *
 * A signature or a successful *submission* is never treated as success: only a
 * `SUCCESS` status for the exact transaction hash is.
 *
 * `simulateRead` is the read-only counterpart: it simulates a single contract
 * call and returns the native return value, without submitting anything.
 */

import {
  Account,
  BASE_FEE,
  Contract,
  StrKey,
  Transaction,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import {
  ConfirmationTimeoutError,
  HeirVaultSdkError,
  SimulationError,
  TransactionFailedError,
  WalletRejectedError,
  parseContractErrorCode,
} from "./errors.js";
import type { SignOptions, WalletSigner } from "./signer.js";

/** Observable phases of a write action, suitable for driving a UI. */
export type TransactionPhase =
  | "building"
  | "simulating"
  | "awaiting-signature"
  | "submitted"
  | "confirming"
  | "success"
  | "failed"
  | "rejected"
  | "pending";

/** A confirmed, successful transaction. */
export interface TxSuccess<T> {
  status: "success";
  hash: string;
  ledger?: number;
  /** The decoded contract return value. */
  value: T;
  /** The raw return value, retained for diagnostics. */
  rawReturnValue?: xdr.ScVal;
}

export interface SubmitOperationParams<T> {
  server: rpc.Server;
  networkPassphrase: string;
  signer: WalletSigner;
  /** Fee-paying source account, which is also the signed address. */
  sourceAddress: string;
  /** The single operation to submit. */
  operation: xdr.Operation;
  /** Decode the contract's return value. */
  decode: (native: unknown) => T;
  timeoutSeconds?: number;
  /** How many `getTransaction` polls to perform before giving up. */
  pollAttempts?: number;
  /** Delay between polls, in milliseconds. */
  pollIntervalMs?: number;
  fee?: string;
  onPhase?: (phase: TransactionPhase) => void;
}

export interface SubmitInvocationParams<T> extends Omit<SubmitOperationParams<T>, "operation"> {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A private, fixed, format-valid account used as the simulated read source. */
export const READ_ONLY_SOURCE = StrKey.encodeEd25519PublicKey(Buffer.from(new Uint8Array(32).fill(0x42)));

/**
 * Build an unsigned invocation of a contract method.
 *
 * Exposed separately so callers can inspect or combine the operation before
 * submitting it.
 */
export function buildInvocation(contractId: string, method: string, args: xdr.ScVal[]): xdr.Operation {
  return new Contract(contractId).call(method, ...args);
}

export interface SimulateReadParams {
  server: rpc.Server;
  networkPassphrase: string;
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  /** Simulated source account; defaults to a fixed, format-valid account. */
  sourceAddress?: string;
}

/**
 * Simulate a read-only contract call and return the native return value.
 *
 * Never submits a transaction, so it costs nothing and needs no signature.
 * Throws {@link SimulationError} (carrying a contract error code when one is
 * present) rather than returning a fabricated value.
 */
export async function simulateRead(params: SimulateReadParams): Promise<unknown> {
  const source = new Account(params.sourceAddress ?? READ_ONLY_SOURCE, "0");
  const transaction = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(buildInvocation(params.contractId, params.method, params.args))
    .setTimeout(30)
    .build();

  const simulation = await params.server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new SimulationError(simulation.error, parseContractErrorCode(simulation.error));
  }
  const retval = simulation.result?.retval;
  if (retval === undefined) {
    throw new SimulationError("The contract returned no value for this read.");
  }
  return scValToNative(retval);
}

/** Simulate a single operation and prepare it for signing. */
export async function prepareOperation(
  params: Pick<SubmitOperationParams<never>, "server" | "networkPassphrase" | "sourceAddress" | "operation" | "timeoutSeconds" | "fee">,
): Promise<{ transaction: Transaction; simulation: rpc.Api.SimulateTransactionResponse; prepared: Transaction }> {
  const source = await params.server.getAccount(params.sourceAddress);
  const transaction = new TransactionBuilder(source, {
    fee: params.fee ?? BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(params.operation)
    .setTimeout(params.timeoutSeconds ?? 60)
    .build();

  const simulation = await params.server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new SimulationError(simulation.error, parseContractErrorCode(simulation.error));
  }
  return { transaction, simulation, prepared: rpc.assembleTransaction(transaction, simulation).build() };
}

/**
 * Run the full write pipeline for a single operation and return a typed
 * {@link TxSuccess}.
 *
 * Every failure mode is surfaced as a distinct typed error:
 *  - {@link WalletRejectedError}      — the user declined to sign;
 *  - {@link SimulationError}          — the call would be rejected;
 *  - {@link TransactionFailedError}   — submitted but reverted on-chain;
 *  - {@link ConfirmationTimeoutError} — accepted but not confirmed in budget.
 */
export async function submitOperation<T>(params: SubmitOperationParams<T>): Promise<TxSuccess<T>> {
  const emit = params.onPhase ?? (() => {});

  emit("building");
  emit("simulating");
  const { prepared } = await prepareOperation(params);

  emit("awaiting-signature");
  const signOptions: SignOptions = {
    address: params.sourceAddress,
    networkPassphrase: params.networkPassphrase,
  };
  let signedXdr: string;
  try {
    signedXdr = await params.signer.signTransaction(prepared.toXDR(), signOptions);
  } catch (error) {
    if (error instanceof WalletRejectedError) throw error;
    throw new WalletRejectedError(
      error instanceof Error ? error.message : "The wallet declined the signature request.",
    );
  }

  const signed = TransactionBuilder.fromXDR(signedXdr, params.networkPassphrase) as Transaction;

  emit("submitted");
  const sendResponse = await params.server.sendTransaction(signed);
  if (sendResponse.status === "ERROR") {
    throw new TransactionFailedError(
      `The network rejected the transaction: ${JSON.stringify(sendResponse.errorResult ?? sendResponse.status)}`,
      sendResponse.hash,
      parseContractErrorCode(sendResponse.errorResult),
    );
  }

  const hash = sendResponse.hash;
  emit("confirming");

  const attempts = params.pollAttempts ?? 30;
  const interval = params.pollIntervalMs ?? 1_000;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await params.server.getTransaction(hash);

    if (response.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      const returnValue = response.returnValue;
      const native = returnValue === undefined ? undefined : scValToNative(returnValue);
      const value = params.decode(native);
      emit("success");
      return {
        status: "success",
        hash,
        ledger: response.ledger,
        value,
        rawReturnValue: returnValue,
      };
    }

    if (response.status === rpc.Api.GetTransactionStatus.FAILED) {
      const code = parseContractErrorCode(response.resultXdr) ?? parseContractErrorCode(response);
      throw new TransactionFailedError("The transaction failed on-chain.", hash, code);
    }

    // NOT_FOUND: not yet included; keep polling.
    if (attempt < attempts - 1) await sleep(interval);
  }

  emit("pending");
  throw new ConfirmationTimeoutError(hash);
}

/** Build and submit a single contract invocation. */
export function submitInvocation<T>(params: SubmitInvocationParams<T>): Promise<TxSuccess<T>> {
  const { contractId, method, args, ...rest } = params;
  return submitOperation<T>({
    ...rest,
    operation: buildInvocation(contractId, method, args),
  });
}

export interface PrepareInvocationParams
  extends Pick<
    SubmitInvocationParams<never>,
    "server" | "networkPassphrase" | "contractId" | "method" | "args" | "sourceAddress" | "timeoutSeconds" | "fee"
  > {}

/**
 * Simulate a contract invocation and prepare it for signing.
 *
 * Throws {@link SimulationError} when simulation fails; a simulation failure
 * means the transaction *would* be rejected (missing contract, unknown
 * entrypoint, failed assertion, insufficient resources).
 */
export function prepareInvocation(
  params: PrepareInvocationParams,
): Promise<{ transaction: Transaction; simulation: rpc.Api.SimulateTransactionResponse }> {
  return prepareOperation({
    ...params,
    operation: buildInvocation(params.contractId, params.method, params.args),
  }).then(({ transaction, simulation }) => ({ transaction, simulation }));
}

/**
 * Non-throwing wrapper around {@link submitOperation}.
 *
 * Returns a discriminated union so a UI can render every outcome without a
 * `try`/`catch`. `status` mirrors {@link TransactionPhase} at the terminal step.
 */
export type InvocationOutcome<T> =
  | { ok: true; result: TxSuccess<T> }
  | { ok: false; phase: TransactionPhase; error: HeirVaultSdkError; hash?: string };

function classify(error: unknown): { phase: TransactionPhase; typed: HeirVaultSdkError; hash?: string } {
  const typed = error instanceof HeirVaultSdkError ? error : new HeirVaultSdkError(String(error));
  if (typed instanceof WalletRejectedError) return { phase: "rejected", typed };
  if (typed instanceof ConfirmationTimeoutError) return { phase: "pending", typed, hash: typed.hash };
  if (typed instanceof TransactionFailedError) return { phase: "failed", typed, hash: typed.hash };
  return { phase: "failed", typed };
}

export async function trySubmitInvocation<T>(params: SubmitInvocationParams<T>): Promise<InvocationOutcome<T>> {
  try {
    return { ok: true, result: await submitInvocation(params) };
  } catch (error) {
    const { phase, typed, hash } = classify(error);
    return hash === undefined ? { ok: false, phase, error: typed } : { ok: false, phase, error: typed, hash };
  }
}

/** Same as {@link trySubmitInvocation} but for a pre-built operation. */
export async function trySubmitOperation<T>(params: SubmitOperationParams<T>): Promise<InvocationOutcome<T>> {
  try {
    return { ok: true, result: await submitOperation(params) };
  } catch (error) {
    const { phase, typed, hash } = classify(error);
    return hash === undefined ? { ok: false, phase, error: typed } : { ok: false, phase, error: typed, hash };
  }
}

/** Fetch an account's current sequence number as a plain string. */
export async function getAccountSequence(server: rpc.Server, address: string): Promise<string> {
  const account: Account = await server.getAccount(address);
  return account.sequenceNumber();
}
