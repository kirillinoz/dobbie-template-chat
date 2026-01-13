import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

/**
 * @title DevSystem
 * @notice Deploys the full system (Counter + VersionManifest) for local development / testing.
 */
const DevSystem = buildModule('DevSystem', (m) => {
  // Deploy Counter
  const counter = m.contract('Counter', []);

  // Deploy VersionManifest
  // Constructor: (bytes32 _projectId, string _versionTag, string[] names, address[] addresses)

  const projectId =
    '0x0000000000000000000000000000000000000000000000000000000000000000';
  const versionTag = 'local-dev';
  const names = ['Counter'];
  const addresses = [counter];

  const manifest = m.contract('VersionManifest', [
    projectId,
    versionTag,
    names,
    addresses,
  ]);

  return { counter, manifest };
});

export default DevSystem;
