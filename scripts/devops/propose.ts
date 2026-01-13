import { network } from 'hardhat';
import {
  encodeFunctionData,
  keccak256,
  toBytes,
  getCreate2Address,
  encodeAbiParameters,
  parseAbiParameters,
  decodeEventLog,
  type Hex,
  getContract,
} from 'viem';
import fs from 'fs';
import path from 'path';

function getAbi(fileName: string) {
  const abiPath = path.join(process.cwd(), 'abi', fileName);
  if (!fs.existsSync(abiPath)) {
    throw new Error(`ABI file not found: ${abiPath}`);
  }
  const fileContent = fs.readFileSync(abiPath, 'utf8');
  const json = JSON.parse(fileContent);
  return json.abi ? json.abi : json;
}

function getArtifact(contractName: string) {
  const artifactPath = path.join(
    process.cwd(),
    `artifacts/contracts/${contractName}.sol/${contractName}.json`
  );
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}`);
  }
  return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
}

interface ContractConfig {
  name: string;
  constructorArgs?: any[];
  constructorTypes?: string;
}

async function main() {
  const {
    PACKAGE_CID,
    PROJECT_ID,
    PR_TITLE,
    PR_NUMBER,
    GOVERNOR_ADDRESS,
    DEPLOYMENT_REGISTRY_ADDRESS,
  } = process.env;

  if (
    !PACKAGE_CID ||
    !PROJECT_ID ||
    !GOVERNOR_ADDRESS ||
    !DEPLOYMENT_REGISTRY_ADDRESS
  ) {
    throw new Error(
      'Missing required env vars: PACKAGE_CID, PROJECT_ID, GOVERNOR_ADDRESS, DEPLOYMENT_REGISTRY_ADDRESS'
    );
  }

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();

  console.log('📋 Batch Deployment Proposal:');
  console.log(`   CID: ${PACKAGE_CID}`);
  console.log(`   Project ID: ${PROJECT_ID}`);

  // Read contracts config from root directory
  const configPath = path.join(process.cwd(), 'deployment-config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error('deployment-config.json not found in project root');
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const contracts: ContractConfig[] = config.contracts || [];

  if (contracts.length === 0) {
    throw new Error('No contracts specified');
  }

  const projectIdBytes = PROJECT_ID as Hex;
  const registryAddress = DEPLOYMENT_REGISTRY_ADDRESS as Hex;

  // Build contract specs
  const contractSpecs: Array<{
    name: string;
    salt: Hex;
    bytecode: Hex;
    expectedAddress: Hex;
  }> = [];

  const deployedNames: string[] = [];
  const deployedAddresses: Hex[] = [];

  console.log('\n📦 Application Contracts:');

  for (const contract of contracts) {
    const artifact = getArtifact(contract.name);
    let bytecode = artifact.bytecode as Hex;

    if (contract.constructorArgs?.length && contract.constructorTypes) {
      const encodedArgs = encodeAbiParameters(
        parseAbiParameters(contract.constructorTypes),
        contract.constructorArgs
      );
      bytecode = (bytecode + encodedArgs.slice(2)) as Hex;
    }

    const bytecodeHash = keccak256(bytecode);
    const salt = keccak256(
      toBytes(`${PACKAGE_CID}.${contract.name}.${bytecodeHash}`)
    ) as Hex;

    const expectedAddress = getCreate2Address({
      from: registryAddress,
      salt,
      bytecode,
    });

    contractSpecs.push({
      name: contract.name,
      salt,
      bytecode,
      expectedAddress,
    });

    deployedNames.push(contract.name);
    deployedAddresses.push(expectedAddress);

    console.log(`   ✓ ${contract.name}: ${expectedAddress}`);
  }

  // Build VersionManifest spec
  console.log('\n📋 Version Manifest:');

  const manifestArtifact = getArtifact('VersionManifest');

  // VersionManifest constructor: (bytes32 _projectId, string _versionTag, string[] names, address[] addresses)
  const manifestConstructorArgs = encodeAbiParameters(
    parseAbiParameters('bytes32,string,string[],address[]'),
    [projectIdBytes, PACKAGE_CID, deployedNames, deployedAddresses]
  );

  const manifestBytecode = (manifestArtifact.bytecode +
    manifestConstructorArgs.slice(2)) as Hex;

  const manifestSalt = keccak256(
    toBytes(`${PACKAGE_CID}.VersionManifest`)
  ) as Hex;

  const manifestAddress = getCreate2Address({
    from: registryAddress,
    salt: manifestSalt,
    bytecode: manifestBytecode,
  });

  console.log(`   Address: ${manifestAddress}`);
  console.log(`   Contracts: ${deployedNames.join(', ')}`);

  // Encode batchDeployAndUpgrade calldata
  const registryAbi = getAbi('DeploymentRegistry.json');
  const calldata = encodeFunctionData({
    abi: registryAbi,
    functionName: 'batchDeployAndUpgrade',
    args: [
      projectIdBytes,
      contractSpecs,
      manifestBytecode,
      manifestSalt,
      manifestAddress,
      PACKAGE_CID, // versionTag
    ],
  });

  // Submit proposal
  const description = `Batch Deploy v${PACKAGE_CID.slice(0, 8)}: ${deployedNames.join(', ')}\n\nPR #${PR_NUMBER || 'N/A'}: ${PR_TITLE || 'Upgrade'}\n\nIPFS: ${PACKAGE_CID}`;

  const governorAbi = getAbi('DevOpsGovernor.json');
  const governor = getContract({
    address: GOVERNOR_ADDRESS as Hex,
    abi: governorAbi,
    client: { public: publicClient, wallet: walletClient },
  });

  console.log('\n🚀 Submitting proposal...');

  const txHash = await governor.write.proposePackage([
    [registryAddress],
    [0n],
    [calldata],
    description,
    projectIdBytes,
    PACKAGE_CID,
    manifestAddress, // Target address is the manifest
  ]);

  console.log(`   Tx Hash: ${txHash}`);

  const startBlock = await publicClient.getBlockNumber();
  console.log(`   Current block: ${startBlock}`);
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1, // Only wait for 1 confirmation
      timeout: 900_000, // 15 minute timeout
    });
  } catch (err) {
    console.error('❌ Transaction confirmation timed out.');
    const latestBlock = await publicClient.getBlockNumber();
    console.log(`   Latest block: ${latestBlock}`);
    throw err;
  }

  let proposalId: string | null = null;
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({
        abi: governorAbi,
        data: log.data,
        topics: log.topics,
      });
      if (
        event &&
        typeof event === 'object' &&
        'eventName' in event &&
        event.eventName === 'ProposalPackageCreated'
      ) {
        const args = (event as any).args;
        proposalId = (args.proposalId || args[0]).toString();
        break;
      }
    } catch {
      continue;
    }
  }

  console.log(`   ✅ Proposal ID: ${proposalId}`);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `proposal_id=${proposalId}\n`);
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `target_address=${manifestAddress}\n`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
