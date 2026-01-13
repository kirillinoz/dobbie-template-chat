import * as fs from 'fs';
import * as path from 'path';
import * as fetch from 'node-fetch';
import { execSync } from 'child_process';
import NodeFormData from 'form-data';
import { createHash } from 'crypto';

const PROPOSAL_ZIP_FILE = 'proposal-package.zip';
const PINATA_API_URL = 'https://uploads.pinata.cloud/v3/files';
const METADATA_FILE = 'proposal-package/proposal-metadata.json';

interface PackageManifest {
  version: string;
  type: string;
  metadata: any;

  files: Array<{ path: string; size: number; type: string }>;
  contracts: Array<{
    name: string;
    path: string;
    bytecodeSize: number;
    abi: any[];
  }>;
  security: {
    dependencies: Array<{
      name: string;
      version: string;
      license: string;
    }>;
  };
  git: {
    repository?: string;
    branch?: string;
    commit: string;
    commitMessage?: string;
    author?: string;
    diffStat?: {
      filesChanged: number;
      insertions: number;
      deletions: number;
    };
  };
  deployment: {
    network?: string;
    estimatedGas?: string;
    requiredRoles?: string[];
  };
  integrity: {
    packageCID: string;
    packageSize: number;
    checksums: {
      sha256: string;
      md5: string;
    };
  };
  governance: {
    proposalType: string;
    impactLevel: string;
  };
}

function safeReadJSON(filePath: string, fallback: any = null) {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠️  File not found: ${filePath}`);
      return fallback;
    }
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) {
      console.log(`  ⚠️  Empty file: ${filePath}`);
      return fallback;
    }
    return JSON.parse(content);
  } catch (error) {
    console.error(
      `  ❌ Failed to parse ${filePath}:`,
      error instanceof Error ? error.message : error
    );
    return fallback;
  }
}

async function getGitInfo() {
  try {
    const commit = execSync('git rev-parse HEAD').toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD')
      .toString()
      .trim();
    const commitMessage = execSync('git log -1 --pretty=%B').toString().trim();
    const author = execSync('git log -1 --pretty=%an').toString().trim();

    let diffStat;
    try {
      // Use HEAD^ to compare with the parent commit
      const diffOutput = execSync('git diff --shortstat HEAD^')
        .toString()
        .trim();
      const diffMatch = diffOutput.match(
        /(\d+) files? changed(?:, (\d+) insertions?)?(?:, (\d+) deletions?)?/
      );
      if (diffMatch) {
        diffStat = {
          filesChanged: parseInt(diffMatch[1] || '0'),
          insertions: parseInt(diffMatch[2] || '0'),
          deletions: parseInt(diffMatch[3] || '0'),
        };
      }
    } catch (_diffError) {
      console.log('  ⚠️  Could not get diff stats (maybe first commit?)');
    }

    let changedFiles: string[] = [];
    try {
      const changedOutput = execSync('git diff --name-only HEAD^')
        .toString()
        .trim();
      changedFiles = changedOutput.split('\n').filter((f) => f.length > 0);
    } catch (e) {
      // Ignore
    }

    let repository;
    try {
      repository = execSync('git config --get remote.origin.url')
        .toString()
        .trim();
    } catch (_repoError) {
      console.log('  ⚠️  No git remote configured');
    }

    return {
      repository,
      branch,
      commit,
      commitMessage,
      author,
      diffStat,
      changedFiles,
    };
  } catch (error) {
    console.warn('  ⚠️  Not a git repository or git not available');
    console.error(error);
    return {
      commit: 'unknown',
      commitMessage: 'unknown',
      changedFiles: [],
    };
  }
}

function getPreviousVersion(): string | null {
  try {
    const content = execSync('git show HEAD^:contracts/VersionManifest.sol', {
      stdio: ['pipe', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    const match = content.match(
      /string\s+public\s+constant\s+VERSION\s*=\s*"([^"]+)"/
    );
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

function determineImpactLevel(
  changedFiles: string[],
  currentVersion: string
): string {
  if (!changedFiles || changedFiles.length === 0) return 'low';

  // 1. Check SemVer Change in VersionManifest.sol
  if (changedFiles.some((f) => f.includes('VersionManifest.sol'))) {
    const prevVersion = getPreviousVersion();
    if (prevVersion) {
      const v1 = currentVersion.split('.').map(Number);
      const v2 = prevVersion.split('.').map(Number);

      if (v1.length === 3 && v2.length === 3) {
        if (v1[0] !== v2[0]) return 'high'; // Major
        if (v1[1] !== v2[1]) return 'medium'; // Minor
        if (v1[2] !== v2[2]) return 'low'; // Patch
      }
    }
    // Fallback if parsing fails or version unchanged but file modified
    return 'high';
  }

  // 2. Check other contracts
  const contractChanged = changedFiles.some(
    (f) => f.endsWith('.sol') && f.startsWith('contracts/')
  );
  if (contractChanged) return 'medium';

  // 3. Default
  return 'low';
}

async function getContractInfo() {
  const contractsDir = path.join(process.cwd(), 'proposal-package/contracts');

  const artifactsDir = path.join(
    process.cwd(),
    'proposal-package/artifacts/contracts'
  );

  if (!fs.existsSync(contractsDir)) {
    console.log('  ⚠️  No contracts directory found in package');
    return [];
  }

  const contracts = [];
  const contractFiles = fs
    .readdirSync(contractsDir)
    .filter((f) => f.endsWith('.sol'));

  for (const contractFile of contractFiles) {
    const contractName = contractFile.replace('.sol', '');
    // Hardhat artifacts are nested
    const artifactPath = path.join(
      artifactsDir,
      `${contractFile}`,
      `${contractName}.json`
    );

    if (fs.existsSync(artifactPath)) {
      const artifact = safeReadJSON(artifactPath, {});
      contracts.push({
        name: contractName,
        path: `contracts/${contractFile}`,
        bytecodeSize: artifact.bytecode?.length
          ? (artifact.bytecode.length - 2) / 2 // Remove 0x prefix
          : 0,
        abi: artifact.abi || [],
      });
    } else {
      console.log(
        `  ⚠️  No matching artifact found for ${contractFile} at ${artifactPath}`
      );
    }
  }
  return contracts;
}

async function getDependencyInfo() {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = safeReadJSON(packageJsonPath, {});
    if (!packageJson) return [];

    const dependencies = [];
    for (const [name, version] of Object.entries(
      packageJson.dependencies || {}
    )) {
      let license = 'Unknown';
      try {
        const depPackageJsonPath = path.join(
          process.cwd(),
          'node_modules',
          name,
          'package.json'
        );
        const depPackageJson = safeReadJSON(depPackageJsonPath);
        if (depPackageJson && depPackageJson.license) {
          license = depPackageJson.license;
        }
      } catch (err) {
        // Ignore errors, keep Unknown
      }

      dependencies.push({
        name,
        version: version as string,
        license,
      });
    }
    return dependencies;
  } catch (error) {
    console.log('  ⚠️  Could not read package.json');
    console.error(error);
    return [];
  }
}

async function getFileStructure(folderPath: string) {
  const files: Array<{ path: string; size: number; type: string }> = [];
  function walkDir(dir: string, baseDir: string = '') {
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const relativePath = path.join(baseDir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          // Exclude node_modules from the file list
          if (item === 'node_modules') continue;
          walkDir(fullPath, relativePath);
        } else {
          files.push({
            path: relativePath,
            size: stat.size,
            type: path.extname(item).slice(1) || 'unknown',
          });
        }
      }
    } catch (error) {
      console.warn(`  ⚠️  Could not read directory: ${dir}`);
      console.error(error);
    }
  }
  if (fs.existsSync(folderPath)) {
    walkDir(folderPath);
  }
  return files;
}

function getManifestVersion(): string {
  try {
    const manifestPath = path.join(
      process.cwd(),
      'contracts',
      'VersionManifest.sol'
    );
    if (!fs.existsSync(manifestPath)) return '1.0.0'; // Fallback
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const match = content.match(
      /string\s+public\s+constant\s+VERSION\s*=\s*"([^"]+)"/
    );
    return match ? match[1] : '1.0.0';
  } catch (error) {
    console.warn('  ⚠️  Could not read VersionManifest.sol version');
    return '1.0.0';
  }
}

function calculateDeploymentGas(contracts: any[]): string {
  // Base cost for transaction (21000) + Contract creation (32000) + Data (200/byte)
  // This is a rough estimation.
  let totalGas = 0;
  for (const contract of contracts) {
    // 21000 transaction base
    // 32000 contract creation
    // 200 * bytecode size (approx for non-zero bytes)
    // We assume 100k overhead for constructor logic per contract as a safe buffer
    const contractGas = 21000 + 32000 + contract.bytecodeSize * 200 + 100000;
    totalGas += contractGas;
  }
  return totalGas.toString();
}

async function uploadToPinata(
  filePath: string,
  fileName: string,
  jwt: string
): Promise<string> {
  console.log(`Uploading ${fileName} to Pinata (V3 Endpoint)...`);

  const formData = new NodeFormData();
  const fileStream = fs.createReadStream(filePath);

  // Use fileStream as the file content
  formData.append('file', fileStream, fileName);

  // Add network as per V3 docs
  formData.append('network', 'public');

  // Create a metadata object
  const metadata = JSON.stringify({
    name: `DevOps-Proposal-${fileName}`,
    keyvalues: {
      app: 'DevOpsGovernor',
      type: fileName === PROPOSAL_ZIP_FILE ? 'package' : 'manifest',
    },
  });

  formData.append('pinataMetadata', metadata);

  const response = await fetch.default(PINATA_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      ...formData.getHeaders(),
    },
    body: formData as any, // Cast to 'any' to bridge type conflict
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pinata API error: ${errorText}`);
  }

  const data = (await response.json()) as { data: { cid: string } };
  if (!data.data || !data.data.cid) {
    throw new Error('Invalid response from Pinata V3 API');
  }
  return data.data.cid;
}

async function main() {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    console.error('❌ Error: PINATA_JWT environment variable is not set.');
    process.exit(1);
  }

  const zipPath = path.join(process.cwd(), PROPOSAL_ZIP_FILE);
  if (!fs.existsSync(zipPath)) {
    console.error(
      `❌ Error: ${PROPOSAL_ZIP_FILE} not found. Did 'package.ts' and 'zip' run?`
    );
    process.exit(1);
  }

  try {
    // Upload the ZIP package
    console.log(`\n📤 Uploading ${PROPOSAL_ZIP_FILE} to IPFS...`);
    const zipCID = await uploadToPinata(zipPath, PROPOSAL_ZIP_FILE, jwt);
    console.log(`  ✓ ZIP uploaded: ${zipCID}`);

    // Build the comprehensive manifest
    console.log(`\n📦 Building comprehensive manifest...`);

    console.log('  Reading metadata...');
    const metadata = safeReadJSON(METADATA_FILE, {
      commitHash: 'unknown',
      createdAt: new Date().toISOString(),
    });

    console.log('  Analyzing contracts...');
    const contracts = await getContractInfo();

    console.log('  Extracting git info...');
    const git = await getGitInfo();

    console.log('  Scanning dependencies...');
    const dependencies = await getDependencyInfo();

    console.log('  Listing files...');
    const files = await getFileStructure(
      path.join(process.cwd(), 'proposal-package')
    );

    // Calculate checksums
    const zipContent = fs.readFileSync(zipPath);
    const sha256 = createHash('sha256').update(zipContent).digest('hex');
    const md5 = createHash('md5').update(zipContent).digest('hex');

    const manifestVersion = getManifestVersion();
    const estimatedGas = calculateDeploymentGas(contracts);
    const impactLevel = determineImpactLevel(git.changedFiles, manifestVersion);

    // Build comprehensive manifest
    const manifest: PackageManifest = {
      version: manifestVersion,
      type: 'proposal-package',
      metadata,
      files: files.slice(0, 100), // Limit to first 100 files for size
      contracts,
      security: {
        dependencies,
      },
      git,
      deployment: {
        network: process.env.DEPLOY_NETWORK || 'sepolia',
        estimatedGas,
        requiredRoles: ['STAKEHOLDER_ROLE', 'PROPAGATOR_ROLE'],
      },
      integrity: {
        packageCID: zipCID,
        packageSize: zipContent.length,
        checksums: { sha256, md5 },
      },
      governance: {
        proposalType: 'upgrade',
        impactLevel,
      },
    };

    // Upload the manifest as a JSON file
    const manifestPath = 'proposal-manifest.json';
    const manifestFileName = 'proposal-manifest.json';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    console.log('\n📤 Uploading manifest.json to IPFS...');
    const manifestCID = await uploadToPinata(
      manifestPath,
      manifestFileName,
      jwt
    );
    console.log(`  ✓ Manifest uploaded: ${manifestCID}`);

    // Save CID to an output file for GitHub Actions
    if (!fs.existsSync('outputs')) fs.mkdirSync('outputs');
    fs.writeFileSync('outputs/cid.txt', manifestCID);

    // Print Summary
    console.log('\n✅ Package uploaded successfully!');
    console.log(`\n📋 Manifest CID: ${manifestCID}`);
    console.log(`📦 Package ZIP CID: ${zipCID}`);
    console.log(`\n📊 Summary:`);
    console.log(`   Contracts: ${contracts.length}`);
    console.log(`   Files: ${files.length}`);
    console.log(`   Package Size: ${(zipContent.length / 1024).toFixed(2)} KB`);
    console.log(`   Git Commit: ${git.commit.slice(0, 8)}`);

    console.log('\n🌐 Gateway URLs:');
    console.log(`   Manifest: https://ipfs.io/ipfs/${manifestCID}`);
    console.log(`   Package: https://ipfs.io/ipfs/${zipCID}`);
  } catch (error) {
    console.error('\n❌ Error during upload process:');
    console.error(error);
    process.exit(1);
  }
}

main();
