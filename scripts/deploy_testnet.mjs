import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  Keypair,
  TransactionBuilder,
  Operation,
  Networks,
  rpc,
  Address,
} from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const server = new rpc.Server(RPC_URL);
const WASM_PATH = path.resolve(
  "../contracts/target/wasm32v1-none/release/heirvault.wasm"
);

async function fundWithFriendbot(address) {
  console.log(`Funding deployer ${address} via Friendbot...`);
  const res = await fetch(`https://horizon-testnet.stellar.org/friendbot?addr=${address}`);
  if (!res.ok) {
    throw new Error(`Friendbot failed with status ${res.status}: ${await res.text()}`);
  }
  console.log("Deployer funded successfully.");
}

async function sendAndConfirm(tx, signer) {
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }

  const simRetval = sim.result?.retval;
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(signer);

  const sendRes = await server.sendTransaction(prepared);
  if (sendRes.status === "ERROR") {
    throw new Error(`Transaction submission error: ${JSON.stringify(sendRes)}`);
  }

  const hash = sendRes.hash;
  console.log(`Submitted transaction: ${hash}. Waiting for confirmation...`);

  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const statusRes = await server.getTransaction(hash);
      if (statusRes.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        console.log(`✓ Confirmed in ledger ${statusRes.ledger}!`);
        return { status: "SUCCESS", ledger: statusRes.ledger, hash, simRetval };
      }
      if (statusRes.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction failed on-chain: ${hash}`);
      }
    } catch (err) {
      if (err.message && err.message.includes("Bad union switch")) {
        // Fallback to raw JSON-RPC
        const rawRes = await fetch(RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTransaction",
            params: { hash },
          }),
        }).then((r) => r.json());
        if (rawRes.result && rawRes.result.status === "SUCCESS") {
          console.log(`✓ Confirmed in ledger ${rawRes.result.ledger} (raw JSON-RPC)!`);
          return { status: "SUCCESS", ledger: rawRes.result.ledger, hash, simRetval };
        }
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Confirmation timeout for ${hash}`);
}

async function deploy() {
  console.log("==================================================");
  console.log("HeirVault Testnet Contract Deployment");
  console.log("==================================================");

  if (!fs.existsSync(WASM_PATH)) {
    throw new Error(`WASM file not found at ${WASM_PATH}`);
  }
  const wasmBytes = fs.readFileSync(WASM_PATH);
  const wasmHash = crypto.createHash("sha256").update(wasmBytes).digest("hex");
  console.log(`Loaded WASM: ${wasmBytes.length} bytes`);
  console.log(`Computed WASM Hash: ${wasmHash}`);

  const deployer = Keypair.random();
  console.log(`Deployer Address: ${deployer.publicKey()}`);
  await fundWithFriendbot(deployer.publicKey());

  let account = await server.getAccount(deployer.publicKey());

  // Step 1: Upload Contract WASM
  console.log("\n--- Step 1: Uploading Contract WASM ---");
  const uploadOp = Operation.uploadContractWasm({ wasm: wasmBytes });
  const uploadTx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(uploadOp)
    .setTimeout(60)
    .build();

  const uploadReceipt = await sendAndConfirm(uploadTx, deployer);
  console.log(`Upload Tx Hash: ${uploadReceipt.hash}`);

  // Step 2: Create Contract Instance
  console.log("\n--- Step 2: Instantiating Contract ---");
  account = await server.getAccount(deployer.publicKey());
  const deployOp = Operation.createCustomContract({
    address: new Address(deployer.publicKey()),
    wasmHash: Buffer.from(wasmHash, "hex"),
  });

  const createTx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(deployOp)
    .setTimeout(60)
    .build();

  const createReceipt = await sendAndConfirm(createTx, deployer);
  console.log(`Create Tx Hash: ${createReceipt.hash}`);

  let contractId = null;
  if (createReceipt.simRetval) {
    contractId = Address.fromScVal(createReceipt.simRetval).toString();
  }

  console.log("\n==================================================");
  console.log("DEPLOYMENT SUCCESSFUL!");
  console.log(`Contract ID: ${contractId}`);
  console.log(`WASM Hash:   ${wasmHash}`);
  console.log(`Upload Tx:   ${uploadReceipt.hash}`);
  console.log(`Create Tx:   ${createReceipt.hash}`);
  console.log("==================================================");

  return { contractId, wasmHash, deployer: deployer.publicKey(), uploadTx: uploadReceipt.hash, createTx: createReceipt.hash };
}

deploy().catch((err) => {
  console.error("Fatal deployment error:", err);
  process.exit(1);
});
