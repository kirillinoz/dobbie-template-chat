import { network } from 'hardhat';
import {
  getContract,
  type Abi,
  type Hex,
  keccak256,
  toHex,
  parseAbi,
  decodeAbiParameters,
} from 'viem';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const { GOVERNOR_ADDRESS, DEPLOYMENT_BLOCK } = process.env;

if (!GOVERNOR_ADDRESS) {
  console.error('Missing required env var: GOVERNOR_ADDRESS');
  process.exit(1);
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

const proposalCreatedAbi = parseAbi([
  'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)',
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractExpectedAddress(calldata: Hex): Hex | null {
  try {
    const data = `0x${calldata.slice(10)}` as Hex;

    // For batch deploy, the expectedManifestAddress is the 5th parameter
    try {
      const decoded = decodeAbiParameters(
        [
          { name: 'projectId', type: 'bytes32' },
          {
            name: 'contracts',
            type: 'tuple[]',
            components: [
              { name: 'name', type: 'string' },
              { name: 'salt', type: 'bytes32' },
              { name: 'bytecode', type: 'bytes' },
              { name: 'expectedAddress', type: 'address' },
            ],
          },
          { name: 'manifestBytecode', type: 'bytes' },
          { name: 'manifestSalt', type: 'bytes32' },
          { name: 'expectedManifestAddress', type: 'address' },
          { name: 'versionTag', type: 'string' },
        ],
        data
      );
      return decoded[4] as Hex;
    } catch {
      return null;
    }
  } catch (_error) {
    console.warn(
      '  ⚠️ Warning: Failed to decode calldata for expected address extraction.'
    );
    return null;
  }
}

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
    process.exit(1);
  }
}

interface ProposalData {
  proposalId: string;
  proposer: string;
  targets: Hex[];
  values: bigint[];
  calldatas: Hex[];
  description: string;
  descriptionHash: Hex;
  voteStart: bigint;
  voteEnd: bigint;
  logBlock: bigint;
  expectedAddress: Hex | null; // Extracted from calldata for batchDeployAndUpgrade
}

interface ProposalResult {
  proposalId: string;
  stateName: string;
  action: string;
}

// --- Cache Management ---

interface CacheData {
  lastScannedBlock: number;
  proposals: ProposalData[];
  timestamp: number;
}

const CACHE_FILE = 'scripts/devops/output/proposal-cache.json';

function loadCache(): CacheData | null {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      // Convert strings back to BigInts
      const data: CacheData = {
        ...raw,
        proposals: raw.proposals.map((p: any) => ({
          ...p,
          values: p.values.map((v: string) => BigInt(v)),
          voteStart: BigInt(p.voteStart),
          voteEnd: BigInt(p.voteEnd),
          logBlock: BigInt(p.logBlock),
          expectedAddress: p.expectedAddress || null, // Preserve expectedAddress
        })),
      };
      console.log(
        `📦 [Cache] Loaded ${data.proposals.length} proposals from cache`
      );
      return data;
    }
  } catch (err) {
    console.warn('[Cache] Failed to load cache:', err);
  }
  return null;
}

function saveCache(data: CacheData): void {
  try {
    if (!fs.existsSync('scripts/devops/output'))
      fs.mkdirSync('scripts/devops/output', { recursive: true });
    // Convert BigInts to strings for JSON serialization
    const serializable = {
      ...data,
      proposals: data.proposals.map((p) => ({
        ...p,
        values: p.values.map((v) => v.toString()),
        voteStart: p.voteStart.toString(),
        voteEnd: p.voteEnd.toString(),
        logBlock: p.logBlock.toString(),
      })),
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(serializable, null, 2));
    console.log(`💾 [Cache] Saved ${data.proposals.length} proposals to cache`);
  } catch (err) {
    console.error('[Cache] Failed to save cache:', err);
  }
}

async function scanBlockchainRange(
  publicClient: any,
  fromBlock: number,
  toBlock: number
): Promise<ProposalData[]> {
  const totalBlocks = toBlock - fromBlock + 1;
  console.log(
    `⛓️  [Scan] Scanning ${totalBlocks} blocks (${fromBlock} to ${toBlock})...`
  );

  const newProposals: ProposalData[] = [];
  const CHUNK_SIZE = 10n; // Alchemy limits
  let scannedBlocks = 0;

  for (
    let start = BigInt(fromBlock);
    start <= BigInt(toBlock);
    start += CHUNK_SIZE
  ) {
    const endBlock =
      start + CHUNK_SIZE - 1n > BigInt(toBlock)
        ? BigInt(toBlock)
        : start + CHUNK_SIZE - 1n;

    const chunkSize = Number(endBlock - start) + 1;
    scannedBlocks += chunkSize;
    const progress = ((scannedBlocks / totalBlocks) * 100).toFixed(1);
    process.stdout.write(
      `\r  📊 Progress: ${scannedBlocks}/${totalBlocks} blocks (${progress}%) | Found: ${newProposals.length} proposals`
    );

    try {
      const logs = await publicClient.getLogs({
        address: GOVERNOR_ADDRESS as Hex,
        event: proposalCreatedAbi[0],
        fromBlock: start,
        toBlock: endBlock,
      });

      for (const log of logs) {
        const args = log.args as any;
        const descriptionHash = keccak256(toHex(args.description));

        let expectedAddress: Hex | null = null;
        if (args.calldatas && args.calldatas.length > 0) {
          expectedAddress = extractExpectedAddress(args.calldatas[0]);
        }

        newProposals.push({
          proposalId: args.proposalId.toString(),
          proposer: args.proposer,
          targets: args.targets,
          values: args.values,
          calldatas: args.calldatas,
          description: args.description,
          descriptionHash,
          voteStart: args.voteStart,
          voteEnd: args.voteEnd,
          logBlock: log.blockNumber,
          expectedAddress,
        });
      }
    } catch (error: any) {
      console.warn(
        `  Warning: Error scanning blocks ${start}-${endBlock}: ${error.message}`
      );
    }

    await sleep(100); // Rate limiting
  }

  console.log(''); // New line
  console.log(`✅ [Scan] Found ${newProposals.length} proposals in range`);
  return newProposals;
}

async function checkExecutionQueue(
  publicClient: any,
  governor: any,
  currentProposalId: bigint,
  currentStartBlock: bigint,
  allProposals: ProposalData[]
): Promise<boolean> {
  console.log('🛡️  Checking Execution Queue...');

  for (const proposal of allProposals) {
    const logProposalId = BigInt(proposal.proposalId);

    if (logProposalId === currentProposalId) continue;

    // Check if this other proposal started BEFORE our current one
    if (proposal.logBlock < currentStartBlock) {
      const state = (await governor.read.state([logProposalId])) as number;

      // 1=Active, 4=Succeeded, 5=Queued
      if (state === 1 || state === 4 || state === 5) {
        console.warn(
          `  ⛔ BLOCKED by older Proposal ID: ${proposal.proposalId} (State: ${PROPOSAL_STATES[state]})`
        );
        return false;
      }
    }
  }

  console.log('  ✅ Queue Clear');
  return true;
}

async function tryQueueOrExecute(
  governor: any,
  publicClient: any,
  walletClient: any,
  proposal: ProposalData,
  state: number,
  allProposals: ProposalData[]
): Promise<{ finalState: string; action: string }> {
  const account = walletClient.account;
  const proposalId = BigInt(proposal.proposalId);

  // Check sequential execution guard
  const isSafe = await checkExecutionQueue(
    publicClient,
    governor,
    proposalId,
    proposal.logBlock,
    allProposals
  );

  if (!isSafe) {
    return { finalState: PROPOSAL_STATES[state], action: 'blocked' };
  }

  const args = [
    proposal.targets,
    proposal.values,
    proposal.calldatas,
    proposal.descriptionHash,
  ];

  if (state === 4) {
    // Succeeded -> Queue
    try {
      console.log(`  📤 Queueing proposal ${proposal.proposalId}...`);
      const { request } = await governor.simulate.queue(args, { account });
      const hash = await governor.write.queue(request.args, { account });
      console.log(`  ✅ Queue tx sent: ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      return { finalState: 'Queued', action: 'queued' };
    } catch (error: any) {
      console.warn(`  ⚠️ Could not queue: ${error.message}`);
      return { finalState: 'Succeeded', action: 'queue_failed' };
    }
  }

  if (state === 5) {
    // Queued -> Execute
    try {
      // Check timelock
      const eta = (await governor.read.proposalEta([proposalId])) as bigint;
      const currentBlock = await publicClient.getBlock({ blockTag: 'latest' });
      const now = currentBlock.timestamp;

      if (now < eta) {
        const remaining = eta - now;
        console.log(`  ⏳ Timelock not passed. ${remaining}s remaining.`);
        return { finalState: 'Queued', action: 'waiting_timelock' };
      }

      console.log(`  🚀 Executing proposal ${proposal.proposalId}...`);
      const { request } = await governor.simulate.execute(args, { account });
      const hash = await governor.write.execute(request.args, { account });
      console.log(`  ✅ Execute tx sent: ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      return { finalState: 'Executed', action: 'executed' };
    } catch (error: any) {
      console.warn(`  ⚠️ Could not execute: ${error.message}`);
      return { finalState: 'Queued', action: 'execute_failed' };
    }
  }

  return { finalState: PROPOSAL_STATES[state], action: 'none' };
}

async function main() {
  console.log('🚀 Starting Proposal Discovery & Processing...\n');

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();

  const governorAbi = getGovernorAbi();
  const governor = getContract({
    address: GOVERNOR_ADDRESS as Hex,
    abi: governorAbi,
    client: { public: publicClient, wallet: walletClient },
  });

  console.log(`📍 Governor: ${GOVERNOR_ADDRESS}`);
  console.log(`🤖 Bot Wallet: ${walletClient.account.address}\n`);

  // Get current block
  const currentBlockNumber = await publicClient.getBlockNumber();
  console.log(`📦 Current block: ${currentBlockNumber}`);

  // Load cache and determine scan range
  const cached = loadCache();
  const deploymentBlock = DEPLOYMENT_BLOCK ? Number(DEPLOYMENT_BLOCK) : 0;
  const lastScanned = cached ? cached.lastScannedBlock : deploymentBlock - 1;
  const knownProposals = cached ? cached.proposals : [];

  console.log(`📍 Last scanned block: ${lastScanned}`);
  console.log(`📍 Deployment block: ${deploymentBlock}\n`);

  // Scan new blocks from blockchain
  const newProposals = await scanBlockchainRange(
    publicClient,
    lastScanned + 1,
    Number(currentBlockNumber)
  );

  // Merge cached + newly found proposals
  const allProposalsMap = new Map<string, ProposalData>();
  knownProposals.forEach((p) => allProposalsMap.set(p.proposalId, p));
  newProposals.forEach((p) => allProposalsMap.set(p.proposalId, p));

  const allProposals = Array.from(allProposalsMap.values());
  console.log(`\n📊 Total proposals discovered: ${allProposals.length}\n`);

  // Update cache
  saveCache({
    lastScannedBlock: Number(currentBlockNumber),
    proposals: allProposals,
    timestamp: Date.now(),
  });

  // Check state and process each proposal
  const results: ProposalResult[] = [];

  for (const proposal of allProposals) {
    const proposalId = BigInt(proposal.proposalId);

    try {
      const state = (await governor.read.state([proposalId])) as number;
      const stateName = PROPOSAL_STATES[state];

      console.log(`\n📋 Proposal ${proposal.proposalId}: ${stateName}`);

      let finalState = stateName;
      let action = 'none';

      // Only process actionable states (Succeeded or Queued)
      if (state === 4 || state === 5) {
        const result = await tryQueueOrExecute(
          governor,
          publicClient,
          walletClient,
          proposal,
          state,
          allProposals
        );
        finalState = result.finalState;
        action = result.action;
      }

      results.push({
        proposalId: proposal.proposalId,
        stateName: finalState,
        action,
      });
    } catch (error: any) {
      console.error(
        `  ❌ Error checking proposal ${proposal.proposalId}: ${error.message}`
      );
      results.push({
        proposalId: proposal.proposalId,
        stateName: 'Error',
        action: 'error',
      });
    }
  }

  // Write results for GitHub Action to consume
  fs.writeFileSync(
    'scripts/devops/output/proposal-states.json',
    JSON.stringify(results, null, 2)
  );

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total proposals: ${results.length}`);

  const queued = results.filter((r) => r.action === 'queued').length;
  const executed = results.filter((r) => r.action === 'executed').length;
  const blocked = results.filter((r) => r.action === 'blocked').length;
  const waiting = results.filter((r) => r.action === 'waiting_timelock').length;

  if (queued > 0) console.log(`  ✅ Queued: ${queued}`);
  if (executed > 0) console.log(`  ✅ Executed: ${executed}`);
  if (blocked > 0) console.log(`  ⛔ Blocked (older pending): ${blocked}`);
  if (waiting > 0) console.log(`  ⏳ Waiting (timelock): ${waiting}`);

  console.log(
    '\n✅ Discovery complete. Results written to scripts/devops/output/proposal-states.json'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
