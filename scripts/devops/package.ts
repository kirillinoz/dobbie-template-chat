// scripts/devops/package.ts
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const PROPOSAL_PACKAGE_DIR = 'proposal-package';

const IGNORE_LIST = [
  '.git', // Version control history (huge)
  '.env', // ❌ SECRETS (Critical to exclude)
  'node_modules', // Dependencies (huge, will be re-installed)
  'cache', // Hardhat cache
  'proposal-package', // The output folder itself (infinite loop prevention)
  'sovereign-test', // ❌ PRIVATE VERIFICATION TESTS (Must stay secret)
  '.DS_Store', // macOS garbage
];

/**
 * Gets list of files changed compared to origin/main.
 * This allows stakeholders to quickly identify what needs review.
 */
function getChangedFiles(): string[] {
  try {
    // Ensure we have the latest main
    execSync('git fetch origin main', { stdio: 'pipe' });

    // Get list of changed files (added, modified, deleted)
    const diffOutput = execSync('git diff --name-status origin/main...HEAD', {
      encoding: 'utf-8',
    });

    // Parse the output into a structured format
    const changedFiles = diffOutput
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const [status, ...pathParts] = line.split('\t');
        const filePath = pathParts.join('\t'); // Handle filenames with tabs
        const statusLabel =
          status === 'A'
            ? 'added'
            : status === 'M'
              ? 'modified'
              : status === 'D'
                ? 'deleted'
                : status.startsWith('R')
                  ? 'renamed'
                  : 'changed';
        return `[${statusLabel}] ${filePath}`;
      });

    return changedFiles;
  } catch (error) {
    console.warn(
      'Warning: Could not get changed files list:',
      (error as Error).message
    );
    return ['Error: Could not determine changed files'];
  }
}

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
  const changedFiles = getChangedFiles();
  const metadata = {
    commitHash: commitHash,
    createdAt: new Date().toISOString(),
    packagingStrategy: 'FULL_REPO_WITH_EXCLUSIONS',
    changedFiles: changedFiles,
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
