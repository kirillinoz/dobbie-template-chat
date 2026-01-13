import { network, artifacts } from 'hardhat';
import { type Hex, getContract, parseAbi } from 'viem';

async function main() {
  const { DEPLOYMENT_REGISTRY_ADDRESS, PROJECT_ID } = process.env;

  if (!DEPLOYMENT_REGISTRY_ADDRESS || !PROJECT_ID) {
    throw new Error(
      'Missing env vars: DEPLOYMENT_REGISTRY_ADDRESS or PROJECT_ID'
    );
  }

  // Setup Viem Client
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  console.log(`🌍 Connecting to Registry at: ${DEPLOYMENT_REGISTRY_ADDRESS}`);

  // Define ABIs for the Lookup Chain
  const registryAbi = parseAbi([
    'function projectBeacons(bytes32 projectId) view returns (address)',
  ]);
  const beaconAbi = parseAbi([
    'function implementation() view returns (address)',
  ]);

  // Get Beacon Address from Registry
  const registry = getContract({
    address: DEPLOYMENT_REGISTRY_ADDRESS as Hex,
    abi: registryAbi,
    client: { public: publicClient },
  });

  const beaconAddress = await registry.read.projectBeacons([PROJECT_ID as Hex]);

  if (beaconAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error(
      '❌ Project not found in Registry. (Beacon address is zero)'
    );
  }
  console.log(`  📍 Beacon found at: ${beaconAddress}`);

  // Get Implementation Address from Beacon
  const beacon = getContract({
    address: beaconAddress,
    abi: beaconAbi,
    client: { public: publicClient },
  });

  const implementationAddress = await beacon.read.implementation();
  console.log(`  📍 Current Implementation: ${implementationAddress}`);

  // Get On-Chain Bytecode
  const onChainCode = await publicClient.getBytecode({
    address: implementationAddress,
  });

  if (!onChainCode || onChainCode === '0x') {
    throw new Error('❌ No bytecode found at implementation address!');
  }

  // Get Local Bytecode
  const contractName = 'VersionManifest';
  const artifact = await artifacts.readArtifact(contractName);
  const localCode = artifact.deployedBytecode;

  // Normalize (Strip Metadata Hash)
  const metadataRegex = /a26469706673[a-f0-9]+$/;
  const cleanOnChain = onChainCode.replace(metadataRegex, '');
  const cleanLocal = localCode.replace(metadataRegex, '');

  console.log('--------------------------------------------------');
  console.log(`On-Chain Length (Clean): ${cleanOnChain.length}`);
  console.log(`Local Length (Clean):    ${cleanLocal.length}`);
  console.log('--------------------------------------------------');

  if (cleanOnChain === cleanLocal) {
    console.log(
      "✅ INTEGRITY PASSED: Local 'main' matches the live Implementation."
    );
  } else {
    console.error('🚨 INTEGRITY FAILURE 🚨');
    console.error("The code in 'main' DOES NOT match the live implementation.");
    console.error(
      'This means your repository is out of sync with the blockchain.'
    );
    console.error(
      "Action: Pull from main, fix conflicts, and ensure you didn't delete live logic."
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
