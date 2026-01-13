# VersionManifest Architecture Analysis

## 1. Overview

`VersionManifest.sol` serves as an **immutable snapshot** of a specific deployment version of a project. It acts as a directory, mapping human-readable contract names (e.g., "Counter", "Treasury") to their deployed addresses on the blockchain.

**Key Characteristics:**

- **Immutable Entry:** Once deployed, a manifest is never modified.
- **Versioned:** Each release (invoked via `batchDeployAndUpgrade` in `DeploymentRegistry`) creates a _new_ `VersionManifest` contract instance.
- **Self-Contained:** It stores the addresses of all contracts belonging to that specific version.

## 2. Integration with DeploymentRegistry

The `DeploymentRegistry` acts as the factory and ledger for these manifests.

### The Deployment Flow (`batchDeployAndUpgrade`)

1.  **Deploy App Contracts**: The contracts for the new version (e.g., a new `Counter`) are deployed via `CREATE2`.
2.  **Deploy Manifest**: A new `VersionManifest` is deployed via `CREATE2`.
    - The constructor is populated with the lists of names and addresses of the just-deployed app contracts.
    - **Storage Write**: The `VersionManifest` writes these mappings to its _own_ storage during construction.
3.  **Upgrade Beacon**: The Registry calls `upgradeTo(manifestAddress)` on the project's `UpgradeableBeacon`.
4.  **Record History**: The manifest address is pushed to the `versionHistory` array in the Registry.

## 3. The Proxy & Beacon Pattern

The project uses a standard OpenZeppelin `BeaconProxy` -> `UpgradeableBeacon` -> `Implementation` (Manifest) pattern to provide a stable identity for the project.

- **Stable Identity**: The `BeaconProxy` address (`projectProxies[id]`) remains constant for the lifetime of the project.
- **Upgradability**: The `UpgradeableBeacon` determines which `VersionManifest` contract is currently active.
- **Resolution**: Users call the Proxy, which delegates execution to the current Manifest.

### Architecture Diagram

```mermaid
graph TD
    User -->|Calls| Proxy[BeaconProxy<br/>(Stable Project Address)]
    Proxy -->|Delegates to| Beacon[UpgradeableBeacon]
    Beacon -->|Points to| ManifestV1[VersionManifest V1<br/>(Implementation)]

    ManifestV1 -.->|Maps 'Counter'| C1[Counter Contract V1]

    %% Upgrade Flow
    Registry[DeploymentRegistry] -->|Upgrades| Beacon
    Registry -->|Deploys| ManifestV2[VersionManifest V2]

    Beacon -.->|Switch to| ManifestV2
    ManifestV2 -.->|Maps 'Counter'| C2[Counter Contract V2]
```

## 4. Critical Technical Analysis

### The Storage vs. DelegateCall Nuance

There is a critical interaction to note between `BeaconProxy` and `VersionManifest`.

1.  **DelegateCall**: `BeaconProxy` uses `delegatecall` to execute the implementation's code in the _Proxy's_ context (using Proxy's storage).
2.  **Constructor Initialization**: `VersionManifest` populates its mappings (`_contracts`) in its `constructor`.
    - Constructors execute in the context of the _deploying contract_ (the Manifest itself).
    - Therefore, the contract addresses are written to the **Manifest's storage**, not the Proxy's.

**Implication**:

- If you call `VersionManifest(manifestAddress).getContract("Counter")` directly: **It works.** It reads from the Manifest's storage where the data exists.
- If you call `VersionManifest(proxyAddress).getContract("Counter")`: **It may fail.**
  - The Proxy delegates to the Manifest code.
  - The code tries to read `_contracts["Counter"]` from the _Proxy's_ storage.
  - Since the Proxy's storage was never initialized with this data (it was written to the Manifest's storage), the lookup will likely return `address(0)`.

**Immutable Variables Exception**:

- `PROJECT_ID` and `DEPLOYED_AT` are declared as `immutable`.
- Immutable values are embedded directly into the contract bytecode at deployment time.
- Therefore, reading `PROJECT_ID` via the Proxy **will work**, because the code executed by the proxy contains the hardcoded values.

### Conclusion on Usage

To successfully lookup contracts for a project version, one should primarily consider:

1.  **Direct Manifest Access**: Querying `registry.getCurrentVersion(id)` to get the manifest address, then calling `getContract(...)` on that address directly.
2.  **Proxy Identity**: The Proxy serves well as a stable identity for _immutable_ metadata (Project ID), but might not support dynamic storage lookups unless the storage strategy is adjusted (e.g., using code-based mappings or initializing proxy storage).
