import {
  getCreate2Address,
  keccak256,
  toBytes,
  encodeAbiParameters,
  parseAbiParameters,
  type Hex,
} from 'viem';
import fs from 'fs';
import path from 'path';

interface ContractConfig {
  name: string;
  constructorArgs?: any[];
  constructorTypes?: string;
}

async function main() {
  const { DEPLOYMENT_REGISTRY_ADDRESS, PACKAGE_CID, PROJECT_ID } = process.env;

  if (!DEPLOYMENT_REGISTRY_ADDRESS || !PACKAGE_CID || !PROJECT_ID) {
    throw new Error('Missing env vars');
  }

  console.log('🔍 Calculating CREATE2 Addresses...\n');

  const configPath = path.join(process.cwd(), 'deployment-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('deployment-config.json not found');
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const contracts: ContractConfig[] = config.contracts || [];

  const registryAddress = DEPLOYMENT_REGISTRY_ADDRESS as Hex;
  const projectIdBytes = PROJECT_ID as Hex;

  // Compute application contract addresses
  const deployedNames: string[] = [];
  const deployedAddresses: Hex[] = [];

  console.log('📦 Application Contracts:');
  for (const contract of contracts) {
    const artifact = JSON.parse(
      fs.readFileSync(
        `artifacts/contracts/${contract.name}.sol/${contract.name}.json`,
        'utf8'
      )
    );

    let bytecode = artifact.bytecode as Hex;
    if (contract.constructorArgs?.length && contract.constructorTypes) {
      const encoded = encodeAbiParameters(
        parseAbiParameters(contract.constructorTypes),
        contract.constructorArgs
      );
      bytecode = (bytecode + encoded.slice(2)) as Hex;
    }

    const bytecodeHash = keccak256(bytecode);
    const salt = keccak256(
      toBytes(`${PACKAGE_CID}.${contract.name}.${bytecodeHash}`)
    ) as Hex;

    const address = getCreate2Address({
      from: registryAddress,
      salt,
      bytecode,
    });

    deployedNames.push(contract.name);
    deployedAddresses.push(address);

    console.log(`  ${contract.name}: ${address}`);
  }

  // Compute VersionManifest address
  console.log('\n📋 Version Manifest:');
  const manifestArtifact = JSON.parse(
    fs.readFileSync(
      'artifacts/contracts/VersionManifest.sol/VersionManifest.json',
      'utf8'
    )
  );

  const manifestArgs = encodeAbiParameters(
    parseAbiParameters('bytes32,string,string[],address[]'),
    [projectIdBytes, PACKAGE_CID, deployedNames, deployedAddresses]
  );

  const manifestBytecode = (manifestArtifact.bytecode +
    manifestArgs.slice(2)) as Hex;
  const manifestSalt = keccak256(
    toBytes(`${PACKAGE_CID}.VersionManifest`)
  ) as Hex;

  const manifestAddress = getCreate2Address({
    from: registryAddress,
    salt: manifestSalt,
    bytecode: manifestBytecode,
  });

  console.log(`  Address: ${manifestAddress}`);
  console.log(`  Contains: ${deployedNames.join(', ')}`);

  // Output for GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `target_address=${manifestAddress}\n`
    );
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `all_addresses=${JSON.stringify({ manifest: manifestAddress, contracts: Object.fromEntries(deployedNames.map((n, i) => [n, deployedAddresses[i]])) })}\n`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
