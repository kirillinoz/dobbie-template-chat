// scripts/devops/package.ts
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const PROPOSAL_PACKAGE_DIR = 'proposal-package';

const IGNORE_LIST = [
  '.git', // Version control history (huge)
  '.github', // GitHub Actions workflows (not needed for logic)
  '.env', // ❌ SECRETS (Critical to exclude)
  'node_modules', // Dependencies (huge, will be re-installed)
  'cache', // Hardhat cache
  'proposal-package', // The output folder itself (infinite loop prevention)
  'sovereign-test', // ❌ PRIVATE VERIFICATION TESTS (Must stay secret)
  '.DS_Store', // macOS garbage
];

function cleanup() {
  console.log('Cleaning up previous build...');
  fs.rmSync(PROPOSAL_PACKAGE_DIR, { recursive: true, force: true });

  fs.mkdirSync(PROPOSAL_PACKAGE_DIR, { recursive: true });
}

function buildAndTest() {
  console.log('Compiling contracts...');
  execSync('pnpm hardhat compile', { stdio: 'inherit' });

  console.log('Running tests and generating report...');
  try {
    execSync(`pnpm hardhat test`, { stdio: 'inherit' });
  } catch (error) {
    console.error('Tests failed! Aborting package. Error: ' + error);
    throw new Error('Tests failed.');
  }
}

function packageFiles(commitHash: string) {
  console.log(`Packaging repository into ${PROPOSAL_PACKAGE_DIR}...`);

  const allFiles = fs.readdirSync(process.cwd());

  for (const fileOrDir of allFiles) {
    // Check against the Ignore List
    if (IGNORE_LIST.includes(fileOrDir)) {
      continue;
    }
    const sourcePath = path.join(process.cwd(), fileOrDir);
    const destPath = path.join(process.cwd(), PROPOSAL_PACKAGE_DIR, fileOrDir);

    // Copy everything else recursively
    console.log(` - Copying ${fileOrDir}...`);
    fs.cpSync(sourcePath, destPath, { recursive: true });
  }

  // Save metadata
  const metadata = {
    commitHash: commitHash,
    createdAt: new Date().toISOString(),
    packagingStrategy: 'FULL_REPO_WITH_EXCLUSIONS',
  };
  const metadataPath = path.join(
    PROPOSAL_PACKAGE_DIR,
    'proposal-metadata.json'
  );
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  console.log(`Metadata saved to ${metadataPath}`);
}

function main() {
  try {
    const commitHash = execSync('git rev-parse HEAD').toString().trim();
    cleanup();
    buildAndTest();
    packageFiles(commitHash);

    console.log(
      `\n✅ Proposal package successfully created at: ${PROPOSAL_PACKAGE_DIR}`
    );
  } catch (error) {
    console.error(
      '\n❌ Error creating proposal package:',
      (error as Error).message
    );
    process.exit(1);
  }
}

main();
