import { network } from 'hardhat';
import {
  getContract,
  type Abi,
  type Hex,
  keccak256,
  toHex,
  parseAbi,
} from 'viem';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const { PROPOSAL_ID, GOVERNOR_ADDRESS, PROPOSAL_BLOCK, DEPLOYMENT_BLOCK } =
  process.env;

if (!PROPOSAL_ID || !GOVERNOR_ADDRESS) {
  console.error('Missing required env vars: PROPOSAL_ID, GOVERNOR_ADDRESS');
  process.exit(3); // Script Error
}

const PROPOSAL_STATES = [
  'Pending',
  'Active',
  'Canceled',
  'Defeated',
  'Succeeded',
  'Queued',
  'Expired',
  'Executed',
];

const EXIT_CODE = {
  SUCCESS: 0, // Executed
  FAILURE: 1, // Canceled, Defeated, Expired
  ACTIVE: 2, // Pending, Active, Succeeded, Queued
  ERROR: 3,
};

const proposalCreatedAbi = parseAbi([
  'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)',
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getGovernorAbi(): Abi {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const abiPath = path.join(__dirname, '../..', 'abi', 'DevOpsGovernor.json');
  try {
    const abiFile = fs.readFileSync(abiPath, 'utf-8');
    const governorArtifact = JSON.parse(abiFile);
    if (!governorArtifact.abi) {
      throw new Error("Invalid ABI file: 'abi' key not found.");
    }
    return governorArtifact.abi;
  } catch (error: any) {
    console.error(`Failed to read ABI: ${error.message}`);
    process.exit(EXIT_CODE.ERROR);
  }
}

async function checkExecutionQueue(
  publicClient: any,
  governor: any,
  currentProposalId: bigint,
  currentStartBlock: bigint
) {
  console.log('🛡️  Checking Execution Queue (First-Past-The-Post Guard)...');

  // Scan for ALL ProposalCreated events
  const fromBlock = DEPLOYMENT_BLOCK ? BigInt(DEPLOYMENT_BLOCK) : 0n;
  const currentBlock = await publicClient.getBlockNumber();

  const CHUNK_SIZE = 10n;
  const allLogs = [];

  for (let start = fromBlock; start <= currentBlock; start += CHUNK_SIZE) {
    const toBlock =
      start + CHUNK_SIZE - 1n > currentBlock
        ? currentBlock
        : start + CHUNK_SIZE - 1n;

    const logs = await publicClient.getLogs({
      address: GOVERNOR_ADDRESS as Hex,
      event: proposalCreatedAbi[0],
      fromBlock: start,
      toBlock,
    });

    allLogs.push(...logs);
    await sleep(100);
  }

  for (const log of allLogs) {
    const logProposalId = log.args.proposalId;

    if (logProposalId === currentProposalId) continue;

    // Check if this other proposal started BEFORE our current one
    if (log.blockNumber < currentStartBlock) {
      const state = (await governor.read.state([logProposalId])) as number;

      // If older proposal is Active (1), Succeeded (4), or Queued (5)
      if (state === 1 || state === 4 || state === 5) {
        console.warn(
          `\n⛔ EXECUTION BLOCKED by older Proposal ID: ${logProposalId}`
        );
        console.warn(`   State: ${PROPOSAL_STATES[state]}`);
        console.warn(`   Order: Older proposal must execute or fail first.`);
        return false; // Block execution
      }
    }
  }

  console.log('✅ Queue Clear. No older active proposals found.');
  return true; // Safe to execute
}

async function findProposalData(publicClient: any, proposalId: bigint) {
  console.log('  Fetching proposal data from ProposalCreated event...');
  try {
    if (PROPOSAL_BLOCK) {
      console.log(
        `  Fast scan: Using provided block number ${PROPOSAL_BLOCK}.`
      );
      const fromBlock = BigInt(PROPOSAL_BLOCK);
      const toBlock = fromBlock + 9n;
      const logs = await publicClient.getLogs({
        address: GOVERNOR_ADDRESS as Hex,
        event: proposalCreatedAbi[0],
        args: { proposalId: proposalId },
        fromBlock,
        toBlock,
      });

      if (logs.length === 0) {
        throw new Error(
          `Event log not found in fast scan (range ${fromBlock}-${toBlock})`
        );
      }
      const log: any = logs[0];
      const { targets, values, calldatas, description } = log.args;
      const descriptionHash = keccak256(toHex(description));
      return {
        targets,
        values,
        calldatas,
        descriptionHash,
        logBlock: log.blockNumber,
      };
    } else if (DEPLOYMENT_BLOCK) {
      console.warn(
        `  PROPOSAL_BLOCK not set. Falling back to slow scan from block ${DEPLOYMENT_BLOCK}.`
      );
      const fromBlock = BigInt(DEPLOYMENT_BLOCK);
      const CHUNK_SIZE = 10n;
      const currentBlock = await publicClient.getBlockNumber();

      for (let start = fromBlock; start <= currentBlock; start += CHUNK_SIZE) {
        const toBlock =
          start + CHUNK_SIZE - 1n > currentBlock
            ? currentBlock
            : start + CHUNK_SIZE - 1n;
        const logs = await publicClient.getLogs({
          address: GOVERNOR_ADDRESS as Hex,
          event: proposalCreatedAbi[0],
          args: { proposalId: proposalId },
          fromBlock: start,
          toBlock,
        });

        if (logs.length > 0) {
          const log: any = logs[0];
          const { targets, values, calldatas, description } = log.args;
          const descriptionHash = keccak256(toHex(description));
          return {
            targets,
            values,
            calldatas,
            descriptionHash,
            logBlock: log.blockNumber,
          };
        }
        await sleep(100);
      }
      throw new Error(
        `Event log not found after slow scan (scanned ${fromBlock} to ${currentBlock})`
      );
    } else {
      throw new Error(
        'Cannot scan for logs: PROPOSAL_BLOCK or DEPLOYMENT_BLOCK must be set.'
      );
    }
  } catch (error: any) {
    console.error(`  Error finding proposal data: ${error.message}`);
    return null;
  }
}

async function trySendTransaction(
  governor: any,
  publicClient: any,
  walletClient: any,
  functionName: 'queue' | 'execute',
  proposalData: {
    targets: Hex[];
    values: bigint[];
    calldatas: Hex[];
    descriptionHash: Hex;
    logBlock: bigint;
  }
) {
  try {
    console.log(`  Attempting to send '${functionName}' transaction...`);
    const account = walletClient.account;
    const args = [
      proposalData.targets,
      proposalData.values,
      proposalData.calldatas,
      proposalData.descriptionHash,
    ];

    const { request } = await governor.simulate[functionName](args, {
      account,
    });
    const hash = await governor.write[functionName](request.args, {
      account,
    });
    console.log(`  ✅ Transaction sent: ${hash}. Waiting for receipt...`);
    await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    console.log(`  ✅ Transaction confirmed!`);

    if (functionName === 'execute') {
      console.log('  Execution successful, exiting with SUCCESS.');
      process.exit(EXIT_CODE.SUCCESS);
    }

    process.exit(EXIT_CODE.ACTIVE);
  } catch (error: any) {
    console.warn(`  - Could not send '${functionName}' tx: ${error.message}`);
    if (error.cause?.message) {
      console.warn(`  - Details: ${error.cause.message}`);
    }
    process.exit(EXIT_CODE.ACTIVE);
  }
}

// --- Main Monitor Logic ---
async function main() {
  console.log(`Checking/advancing status for Proposal ID: ${PROPOSAL_ID}`);
  const proposalId = BigInt(PROPOSAL_ID!);

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  const botAccount = walletClient.account;

  const governorAbi = getGovernorAbi();
  const governor = getContract({
    address: GOVERNOR_ADDRESS as Hex,
    abi: governorAbi,
    client: { public: publicClient, wallet: walletClient },
  });
  console.log(`  Governor: ${governor.address}`);
  console.log(`  Bot Wallet: ${botAccount.address}`);

  let state: number;
  try {
    state = (await governor.read.state([proposalId])) as number;
    console.log(`CURRENT_STATE_NAME:${PROPOSAL_STATES[state]}`);
  } catch (error: any) {
    console.error('  Error fetching proposal state:');
    console.error(error.message);
    process.exit(EXIT_CODE.ERROR);
  }

  let proposalData;
  if (state >= 1) {
    proposalData = await findProposalData(publicClient, proposalId);
    if (!proposalData && (state === 4 || state === 5)) {
      console.error('  Cannot proceed without proposal data. Exiting.');
      process.exit(EXIT_CODE.ERROR);
    }
  }

  switch (state) {
    case 2: // Canceled
    case 3: // Defeated
    case 6: // Expired
      console.error(`\n❌ Proposal has Failed.`);
      process.exit(EXIT_CODE.FAILURE);

    case 0: // Pending
    case 1: // Active
      console.log(`  Proposal is still voting.`);
      process.exit(EXIT_CODE.ACTIVE);

    case 4: // Succeeded
      console.log('  Proposal Succeeded. Attempting to queue...');
      // Guard Check before Queueing
      if (proposalData && proposalData.logBlock) {
        const isSafe = await checkExecutionQueue(
          publicClient,
          governor,
          proposalId,
          proposalData.logBlock
        );
        if (!isSafe) process.exit(EXIT_CODE.ACTIVE);
      }

      await trySendTransaction(
        governor,
        publicClient,
        walletClient,
        'queue',
        proposalData!
      );
      break;

    case 5: // Queued
      console.log('  Proposal is Queued. Checking timelock...');

      // Guard Check before Execution (CRITICAL)
      if (proposalData && proposalData.logBlock) {
        const isSafe = await checkExecutionQueue(
          publicClient,
          governor,
          proposalId,
          proposalData.logBlock
        );
        if (!isSafe) {
          console.log('  ⏳ Waiting for older proposal to resolve...');
          process.exit(EXIT_CODE.ACTIVE);
        }
      }

      try {
        const eta = (await governor.read.proposalEta([proposalId])) as bigint;
        const currentBlock = await publicClient.getBlock({
          blockTag: 'latest',
        });
        const now = currentBlock.timestamp;

        console.log(`  Current Time: ${now}`);
        console.log(`  Executable At: ${eta}`);

        if (now >= eta) {
          console.log('  Timelock passed. Attempting to execute...');
          await trySendTransaction(
            governor,
            publicClient,
            walletClient,
            'execute',
            proposalData!
          );
        } else {
          console.log(`  Timelock not passed. Waiting...`);
          process.exit(EXIT_CODE.ACTIVE);
        }
      } catch (error: any) {
        console.error(`  Error checking ETA: ${error.message}`);
        process.exit(EXIT_CODE.ERROR);
      }
      break;

    case 7: // Executed
      console.log(`\n✅ Proposal has been Executed.`);
      process.exit(EXIT_CODE.SUCCESS);

    default:
      console.error(`\n🚨 Unknown proposal state received: ${state}`);
      process.exit(EXIT_CODE.ERROR);
  }
}

main();
