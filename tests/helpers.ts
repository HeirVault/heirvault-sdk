import {
  Account,
  Address,
  Keypair,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

import type { WalletSigner } from "../src/signer.js";

export const TEST_PASSPHRASE = "Test SDF Network ; September 2015";
export const TEST_CONTRACT = "CC6QRWVXN3V4UOADEZSGXNYRQMR252BXH6ERXOSENR64JTKIRCGA3ADO";

/** A parsed simulation-success response `rpc.assembleTransaction` accepts. */
export function successSimulation(retval: xdr.ScVal): rpc.Api.SimulateTransactionResponse {
  return {
    _parsed: true,
    latestLedger: 1,
    transactionData: new SorobanDataBuilder(),
    minResourceFee: "1000",
    events: [],
    result: { auth: [], retval },
  } as unknown as rpc.Api.SimulateTransactionResponse;
}

/** A parsed simulation-error response. */
export function errorSimulation(message: string): rpc.Api.SimulateTransactionResponse {
  return {
    _parsed: true,
    latestLedger: 1,
    events: [],
    error: message,
  } as unknown as rpc.Api.SimulateTransactionResponse;
}

export function successTx(returnValue: xdr.ScVal, ledger = 7): rpc.Api.GetTransactionResponse {
  return {
    status: rpc.Api.GetTransactionStatus.SUCCESS,
    ledger,
    returnValue,
  } as unknown as rpc.Api.GetTransactionResponse;
}

export function failedTx(): rpc.Api.GetTransactionResponse {
  return { status: rpc.Api.GetTransactionStatus.FAILED } as unknown as rpc.Api.GetTransactionResponse;
}

export function notFoundTx(): rpc.Api.GetTransactionResponse {
  return { status: rpc.Api.GetTransactionStatus.NOT_FOUND } as unknown as rpc.Api.GetTransactionResponse;
}

export interface FakeServerConfig {
  /** Simulation responses, consumed in order; the last one repeats. */
  simulations: rpc.Api.SimulateTransactionResponse[];
  send?: { status: "PENDING" | "DUPLICATE" | "TRY_AGAIN_LATER" | "ERROR"; hash: string };
  /** Transaction responses, consumed in order; the last one repeats. */
  transactions?: rpc.Api.GetTransactionResponse[];
}

export interface FakeServer {
  server: rpc.Server;
  /** Transactions passed to `simulateTransaction`, in order. */
  simulated: Transaction[];
  simulateCalls: number;
}

/**
 * A minimal fake Soroban RPC server. It records the transactions it is asked to
 * simulate so tests can assert which contract method was invoked.
 */
export function fakeServer(config: FakeServerConfig): FakeServer {
  const simulated: Transaction[] = [];
  let simulateIndex = 0;
  let transactionIndex = 0;

  const server = {
    async getAccount(address: string): Promise<Account> {
      return new Account(address, "1");
    },
    async simulateTransaction(tx: Transaction) {
      simulated.push(tx);
      const response = config.simulations[Math.min(simulateIndex, config.simulations.length - 1)];
      simulateIndex += 1;
      return response;
    },
    async sendTransaction() {
      return { status: "PENDING", hash: "00".repeat(32), ...config.send };
    },
    async getTransaction() {
      const list = config.transactions ?? [successTx(xdr.ScVal.scvVoid())];
      const response = list[Math.min(transactionIndex, list.length - 1)];
      transactionIndex += 1;
      return response;
    },
  } as unknown as rpc.Server;

  return { server, simulated, get simulateCalls() {
    return simulateIndex;
  } };
}

/** A signer that really signs the envelope with a throwaway keypair. */
export function signingSigner(): { signer: WalletSigner; keypair: Keypair } {
  const keypair = Keypair.random();
  const signer: WalletSigner = {
    async getAddress() {
      return keypair.publicKey();
    },
    async signTransaction(envelopeXdr: string) {
      const tx = TransactionBuilder.fromXDR(envelopeXdr, TEST_PASSPHRASE) as Transaction;
      tx.sign(keypair);
      return tx.toXDR();
    },
  };
  return { signer, keypair };
}

interface InvokeOperation {
  type: string;
  func?: xdr.HostFunction;
}

function invokeArgs(op: InvokeOperation | undefined): xdr.InvokeContractArgs | undefined {
  if (!op || op.type !== "invokeHostFunction" || !op.func) return undefined;
  return op.func.invokeContract();
}

/** Read the invoked contract method name from a simulated transaction. */
export function invokedMethod(tx: Transaction): string | undefined {
  const args = invokeArgs(tx.operations[0] as unknown as InvokeOperation);
  if (!args) return undefined;
  return args.functionName().toString();
}

/** Read the invoked contract address from a simulated transaction. */
export function invokedContract(tx: Transaction): string | undefined {
  const args = invokeArgs(tx.operations[0] as unknown as InvokeOperation);
  if (!args) return undefined;
  return Address.fromScAddress(args.contractAddress()).toString();
}
