import { HeirVaultClient } from '../dist/index.js';

async function main() {
  const client = new HeirVaultClient({
    contractId: 'CB4I2OSSNXQCH3DGHKGYMG5DPDOUDD55YG3SSDOK4JICVDH5B7KLEWI6',
    network: 'testnet'
  });

  console.log('=================================================================');
  console.log('   HEIRVAULT TESTNET EVIDENCE VERIFICATION: VAULT ID 9           ');
  console.log('=================================================================');

  console.log('\n--- 1. Live On-Chain State Inspection ---');
  const vault = await client.getVault(9n);
  console.log('Vault 9 on-chain state:');
  console.log('  Owner:                ', vault.owner);
  console.log('  Asset:                ', vault.asset);
  console.log('  Status:               ', vault.status);
  console.log('  Balance:              ', vault.balance.toString(), 'stroops');
  console.log('  Total Allocation Bps: ', vault.totalAllocationBps, '(100%)');
  console.log('  Check-in Period:      ', vault.checkInPeriodSeconds, 's');
  console.log('  Grace Period:         ', vault.gracePeriodSeconds, 's');

  const claims = await client.getClaims(9n);
  console.log('\nClaims recorded:', claims.items.length);
  for (const c of claims.items) {
    console.log(`  Beneficiary: ${c.beneficiary}`);
    console.log(`    Allocation:    ${c.allocationBps} bps`);
    console.log(`    Entitlement:   ${c.entitlement.toString()} stroops`);
    console.log(`    Claimed:       ${c.claimed}`);
    console.log(`    ClaimedAmount: ${c.claimedAmount.toString()} stroops`);
  }

  const undistributed = await client.getUndistributedBalance(9n);
  console.log('Undistributed Balance:', undistributed.toString(), 'stroops');

  const txHashes = [
    { step: '1. Create Vault', hash: 'a6eba71756aefaf7488628f8723bb8b7ef5d8efd4744191b7f450cbf37d5ea94' },
    { step: '2. Add Beneficiary', hash: 'bde8d5d9c247f042c46ec9f7a4f83a7459d0622964696b6a86de7ff1a840eddf' },
    { step: '3. Add Guardian', hash: '1bf32b6e36b7076f8bb40a85a681165774cb024bf4262b36b9a1f3e523d17dfc' },
    { step: '4. Set Threshold', hash: '949684fd5ba8ea5a0047bbc14551637d6474ca8ad63104b80a760f8124dbaa01' },
    { step: '5. Deposit', hash: '08582a3123d50fb581078a0482dd2000c705ef92c42fe8301ee34c2904128e15' },
    { step: '6. Check-in', hash: 'e7e173bc42fd7dcd749808e5e9cfcdc19f4410763ba570deb1a348047097027a' },
    { step: '8. Guardian Approval', hash: '6cd011c26f25eaacb1b2c9bcf807e5e73f8c470f70acc18fa032aa7f614bee57' },
    { step: '9. Activate Vault', hash: '220b619f051f7cd2439f88af5d8e849a953cc48a81ec6f36224ccfb5ddf8d59c' },
    { step: '12. Claim', hash: '0403751717a70f848c69f991d0f2e6a4b0373d04d90f3dd048b2fb2e3cb5fa6f' }
  ];

  console.log('\n--- 2. On-Chain Transaction Verification (Soroban RPC) ---');
  for (const item of txHashes) {
    const res = await fetch('https://soroban-testnet.stellar.org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: { hash: item.hash }
      })
    });
    const json = await res.json();
    const st = json.result ? json.result.status : 'NOT_FOUND';
    const ledger = json.result ? json.result.ledger : 'N/A';
    const latestLedger = json.result ? json.result.latestLedger : 'N/A';
    console.log(`  [${st}] Ledger ${ledger} (latest: ${latestLedger}): ${item.step}`);
    console.log(`         Hash: ${item.hash}`);
    console.log(`         Explorer: https://stellar.expert/explorer/testnet/tx/${item.hash}`);
  }
}

main().catch(console.error);
