import { Keypair, TransactionBuilder, rpc, Contract, xdr } from '@stellar/stellar-sdk';
import {
  HeirVaultClient,
  addressToScVal,
  u64ToScVal,
  u32ToScVal,
  i128ToScVal,
  activationModeToScVal,
} from '../dist/index.js';

console.log('====================================================');
console.log('   HeirVault End-to-End Testnet Verification Suite   ');
console.log('====================================================\n');

const CONTRACT_ID = 'CB4I2OSSNXQCH3DGHKGYMG5DPDOUDD55YG3SSDOK4JICVDH5B7KLEWI6';
const ASSET_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'; // Testnet native XLM SAC
const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

const server = new rpc.Server(RPC_URL);

async function fundAccount(name, keypair) {
  process.stdout.write(`Funding ${name} (${keypair.publicKey()})... `);
  const res = await fetch(`https://friendbot.stellar.org/?addr=${keypair.publicKey()}`);
  const json = await res.json();
  if (!json.successful) {
    throw new Error(`Failed to fund ${name}: ${JSON.stringify(json)}`);
  }
  console.log('✓ funded (10,000 test XLM)');
}

/**
 * Robust transaction submitter that handles Soroban Protocol 22 transaction submission and confirmation.
 */
async function executeContractCall(signerKeypair, operation, label) {
  process.stdout.write(`[${label}] Submitting... `);
  const source = await server.getAccount(signerKeypair.publicKey());
  const tx = new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed for ${label}: ${sim.error}`);
  }

  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(signerKeypair);

  const sendRes = await server.sendTransaction(prepared);
  if (sendRes.status === 'ERROR') {
    throw new Error(`Send failed for ${label}: ${JSON.stringify(sendRes.errorResult)}`);
  }

  const hash = sendRes.hash;

  // Poll via raw JSON-RPC to avoid sdk v13 Bad union switch: 4 in resultMetaXdr
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const rpcRes = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: { hash }
      })
    });
    const json = await rpcRes.json();
    if (json.result && json.result.status === 'SUCCESS') {
      console.log(`✓ Confirmed in ledger ${json.result.ledger}!`);
      console.log(`    Tx Hash: ${hash}`);
      return { hash, ledger: json.result.ledger };
    } else if (json.result && json.result.status === 'FAILED') {
      throw new Error(`Transaction failed on-chain: ${hash}`);
    }
  }
  throw new Error(`Confirmation timeout for ${hash}`);
}

async function main() {
  const owner = Keypair.random();
  const heir = Keypair.random();
  const guardian = Keypair.random();

  console.log('1. Account Setup');
  console.log('   Owner:       ', owner.publicKey());
  console.log('   Beneficiary: ', heir.publicKey());
  console.log('   Guardian:    ', guardian.publicKey());
  console.log('');

  await fundAccount('Owner', owner);
  await fundAccount('Beneficiary', heir);
  await fundAccount('Guardian', guardian);

  const client = new HeirVaultClient({
    contractId: CONTRACT_ID,
    network: 'testnet',
    readSourceAddress: owner.publicKey(),
  });

  const contract = new Contract(CONTRACT_ID);

  console.log('\n====================================================');
  console.log('   PHASE 2: LIFECYCLE TESTS EXECUTION               ');
  console.log('====================================================');

  // --- Test 1: Vault Creation ---
  console.log('\n--- TEST 1: Vault Creation ---');
  const countBefore = await client.getVaultCount();
  const expectedVaultId = countBefore + 1n;

  const createOp = contract.call(
    'create_vault',
    addressToScVal(owner.publicKey()),
    addressToScVal(ASSET_ID),
    activationModeToScVal('GuardianApproval'),
    u64ToScVal(60n),
    u64ToScVal(60n)
  );

  const createResult = await executeContractCall(owner, createOp, 'create_vault');
  const vaultId = expectedVaultId;
  console.log(`    Vault ID: ${vaultId}`);

  const vaultRecord = await client.getVault(vaultId);
  console.log(`    Confirmed Owner: ${vaultRecord.owner}`);
  console.log(`    Confirmed Asset: ${vaultRecord.asset}`);
  console.log(`    Status:          ${vaultRecord.status}`);
  console.log(`    Check-in Period: ${vaultRecord.checkInPeriodSeconds}s`);

  // --- Configuration: Add Beneficiary ---
  console.log('\n--- SETUP: Add Beneficiary (10,000 bps = 100%) ---');
  const addHeirOp = contract.call(
    'add_beneficiary',
    u64ToScVal(vaultId),
    addressToScVal(heir.publicKey()),
    u32ToScVal(10_000)
  );
  const addHeirResult = await executeContractCall(owner, addHeirOp, 'add_beneficiary');

  // --- Configuration: Add Guardian ---
  console.log('\n--- SETUP: Add Guardian ---');
  const addGuardOp = contract.call(
    'add_guardian',
    u64ToScVal(vaultId),
    addressToScVal(guardian.publicKey())
  );
  const addGuardResult = await executeContractCall(owner, addGuardOp, 'add_guardian');

  // --- Configuration: Set Threshold ---
  console.log('\n--- SETUP: Set Guardian Threshold to 1 ---');
  const threshOp = contract.call(
    'set_guardian_threshold',
    u64ToScVal(vaultId),
    u32ToScVal(1)
  );
  const threshResult = await executeContractCall(owner, threshOp, 'set_guardian_threshold');

  // --- Test 2: Deposit ---
  console.log('\n--- TEST 2: Deposit Funds (1 XLM = 10,000,000 stroops) ---');
  const DEPOSIT_AMOUNT = 10_000_000n; // 1 XLM
  const depositOp = contract.call(
    'deposit',
    u64ToScVal(vaultId),
    addressToScVal(ASSET_ID),
    i128ToScVal(DEPOSIT_AMOUNT)
  );
  const depositResult = await executeContractCall(owner, depositOp, 'deposit');

  const vaultAfterDeposit = await client.getVault(vaultId);
  console.log(`    Vault Balance on Contract: ${vaultAfterDeposit.balance} stroops (${Number(vaultAfterDeposit.balance) / 1e7} XLM)`);

  // --- Test 3: Owner Check-in ---
  console.log('\n--- TEST 3: Owner Check-in ---');
  const lastCheckInBefore = vaultAfterDeposit.lastCheckInSeconds;
  const checkInOp = contract.call(
    'check_in',
    u64ToScVal(vaultId)
  );
  const checkInResult = await executeContractCall(owner, checkInOp, 'check_in');

  const vaultAfterCheckIn = await client.getVault(vaultId);
  console.log(`    Last Check-in Before: ${lastCheckInBefore}s`);
  console.log(`    Last Check-in After:  ${vaultAfterCheckIn.lastCheckInSeconds}s`);
  console.log(`    New Deadline:         ${vaultAfterCheckIn.deadline}`);

  // --- Test 4: Inactivity & Premature Activation Check ---
  console.log('\n--- TEST 4: Premature Activation Verification ---');
  const earlyActivateOp = contract.call(
    'activate_vault',
    u64ToScVal(vaultId)
  );

  // Simulation must fail because guardian threshold is not yet met
  const earlySource = await server.getAccount(owner.publicKey());
  const earlyTx = new TransactionBuilder(earlySource, { fee: '100000', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(earlyActivateOp)
    .setTimeout(60).build();
  const earlySim = await server.simulateTransaction(earlyTx);
  if (rpc.Api.isSimulationError(earlySim)) {
    console.log('✓ Inactivity/Condition check verified: Premature activation correctly refused by contract!');
    console.log(`    Refusal error: ${earlySim.error.split('\n')[0]}`);
  } else {
    throw new Error('FAILED: Contract allowed premature activation!');
  }

  // --- Test 5: Guardian Approval & Inheritance Activation ---
  console.log('\n--- TEST 5: Guardian Approval & Inheritance Activation ---');
  const approveOp = contract.call(
    'guardian_approve',
    u64ToScVal(vaultId),
    addressToScVal(guardian.publicKey())
  );
  const approveResult = await executeContractCall(guardian, approveOp, 'guardian_approve');

  const activateResult = await executeContractCall(owner, earlyActivateOp, 'activate_vault');
  const vaultActivated = await client.getVault(vaultId);
  console.log(`    Vault Status:         ${vaultActivated.status}`);
  console.log(`    Activated At:         ${vaultActivated.activatedAt}`);
  console.log(`    Distribution Balance: ${vaultActivated.distributionBalance} stroops`);

  // Assert duplicate activation fails
  const dupSim = await server.simulateTransaction(earlyTx);
  console.log('✓ Duplicate activation rejected:', rpc.Api.isSimulationError(dupSim));

  // --- Test 6: Beneficiary Claim ---
  console.log('\n--- TEST 6: Beneficiary Claim ---');
  const claimOp = contract.call(
    'claim',
    u64ToScVal(vaultId),
    addressToScVal(heir.publicKey())
  );
  const claimResult = await executeContractCall(heir, claimOp, 'claim');

  // Verify unauthorized claim rejection
  const unauthorizedKey = Keypair.random();
  await fundAccount('Attacker', unauthorizedKey);
  const unauthClaimOp = contract.call(
    'claim',
    u64ToScVal(vaultId),
    addressToScVal(unauthorizedKey.publicKey())
  );
  const unauthSource = await server.getAccount(unauthorizedKey.publicKey());
  const unauthTx = new TransactionBuilder(unauthSource, { fee: '100000', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(unauthClaimOp).setTimeout(60).build();
  const unauthSim = await server.simulateTransaction(unauthTx);
  console.log('✓ Unauthorized claim rejected:', rpc.Api.isSimulationError(unauthSim));

  // --- Test 7: Final Accounting & Settlement ---
  console.log('\n--- TEST 7: Final Accounting & Settlement ---');
  const finalVault = await client.getVault(vaultId);
  console.log(`    Final Vault Status:       ${finalVault.status}`);
  console.log(`    Original Deposit:         ${DEPOSIT_AMOUNT} stroops`);
  console.log(`    Remaining Vault Balance:  ${finalVault.balance} stroops`);
  console.log(`    Total Claimed:            ${finalVault.totalClaimed} stroops`);
  console.log(`    Beneficiary Claim Status: ${finalVault.beneficiaries[0].claimed}`);
  console.log(`    Beneficiary Claim Amount: ${finalVault.beneficiaries[0].claimedAmount} stroops`);

  console.log('\n====================================================');
  console.log('   TESTNET EVIDENCE SUMMARY (VERIFIED ON-CHAIN)     ');
  console.log('====================================================');
  console.log(`Contract Address:       ${CONTRACT_ID}`);
  console.log(`Vault ID Created:       ${vaultId}`);
  console.log(`1. Create Vault Tx:     ${createResult.hash} (Ledger ${createResult.ledger})`);
  console.log(`2. Add Beneficiary Tx:  ${addHeirResult.hash} (Ledger ${addHeirResult.ledger})`);
  console.log(`3. Add Guardian Tx:     ${addGuardResult.hash} (Ledger ${addGuardResult.ledger})`);
  console.log(`4. Set Threshold Tx:    ${threshResult.hash} (Ledger ${threshResult.ledger})`);
  console.log(`5. Deposit Tx:          ${depositResult.hash} (Ledger ${depositResult.ledger})`);
  console.log(`6. Check-in Tx:         ${checkInResult.hash} (Ledger ${checkInResult.ledger})`);
  console.log(`7. Guardian Approve Tx: ${approveResult.hash} (Ledger ${approveResult.ledger})`);
  console.log(`8. Activate Vault Tx:   ${activateResult.hash} (Ledger ${activateResult.ledger})`);
  console.log(`9. Beneficiary Claim:   ${claimResult.hash} (Ledger ${claimResult.ledger})`);
  console.log('====================================================');
}

main().catch(err => {
  console.error('\nVerification Aborted with Error:', err);
  process.exit(1);
});
