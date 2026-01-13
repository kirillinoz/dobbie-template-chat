# Dobbie Template

**Dobbie Template** is the official boilerplate for creating smart contract repositories compatible with the **Dobbie DevOps Platform**. It provides a pre-configured environment for developing, testing, verifying, and versioning smart contracts in a collaborative team setting.

## Features

- **Hardhat 3 (Beta)**: configured with `viem` for a modern, fast development experience.
- **Dobbie DevOps Integration**: Includes a suite of scripts in `scripts/devops` to integrate seamlessly with the Dobbie platform for proposal discovery, package uploading, and integrity verification.
- **Hybrid Testing**: Supports both **Solidity** (Foundry-style) and **TypeScript** (via `node:test`) test suites.
- **Sample Contracts**: Includes a `Counter` contract and a `VersionManifest` for version control.
- **Ignition Deployment**: Ready-to-use deployment modules.

## Getting Started

### Prerequisites

- Node.js (v22 or later)
- pnpm

### Installation

1.  Clone this repository (or use "Use this template").
2.  Install dependencies:

    ```bash
    pnpm install
    ```

3.  Set up your environment variables:

    ```bash
    cp .env.example .env
    # Edit .env with your configuration (RPC URLs, Private Keys, etc.)
    ```

## Usage

### Compile Contracts

Compile your Solidity contracts:

```bash
pnpm compile
```

### Run Tests

Run both Solidity and TypeScript tests:

```bash
pnpm test
```

### Deployment

Deploy to the Sepolia testnet using Hardhat Ignition:

```bash
pnpm deploy:sepolia
```

## Project Structure

- **`contracts/`**: Smart contract source files (`.sol`).
- **`scripts/devops/`**: Dobbie integration scripts.
  - `check-status.ts`: Checks the status of the repository.
  - `package.ts`: Packages artifacts for upload.
  - `upload.ts`: Uploads packages to the Dobbie registry.
  - `verify-integrity.ts`: Verifies the integrity of local files against the registry.
- **`test/`**: TypeScript tests using `viem` and `node:test`.
- **`ignition/`**: Deployment modules.
- **`hardhat.config.ts`**: Hardhat configuration file.

## Dobbie Workflow

1.  **Develop**: Write your contracts in `contracts/`.
2.  **Test**: Ensure correctness with `pnpm test`.
3.  **Deploy**: Use the provided scripts to deploy your system.
4.  **Integrate**: Use the `scripts/devops` tools to manage your contract versions and proposals within your team's Dobbie workflow.
