import assert from 'node:assert/strict';
import { network } from 'hardhat';
import { keccak256, encodePacked } from 'viem';
import { describe, it } from 'node:test';

describe('VersionManifest', async function () {
  const { viem } = (await network.connect()) as any;
  //const publicClient = await viem.getPublicClient();

  it('Should deploy with correct version and handle getters', async function () {
    // 1. Prepare constructor arguments
    const projectId = keccak256(encodePacked(['string'], ['test-project']));
    const versionTag = 'v1.0.0';
    const names = ['ContractA', 'ContractB', 'HubChatRewards'];

    // Deploy dummy contracts or just address generation
    // Easier: Just use random accounts from the test node
    const clients = await viem.getWalletClients();
    const addresses = clients.slice(0, 3).map((c) => c.account.address);

    // 2. Deploy VersionManifest
    const manifest = await viem.deployContract('VersionManifest', [
      projectId,
      versionTag,
      names,
      addresses,
    ]);

    // 3. Test interactions

    // Check Constants
    const version = await manifest.read.VERSION();
    assert.equal(version, '0.0.2');

    // Check Public Variables
    const storedVersionTag = await manifest.read.versionTag();
    assert.equal(storedVersionTag, versionTag);

    // Check getContract
    const addrA = (await manifest.read.getContract(['ContractA'])) as string;
    assert.equal(addrA.toLowerCase(), addresses[0].toLowerCase());

    const addrB = (await manifest.read.getContract(['ContractB'])) as string;
    assert.equal(addrB.toLowerCase(), addresses[1].toLowerCase());

    // Check getAllContracts
    const [allNames, allAddresses] =
      (await manifest.read.getAllContracts()) as [string[], string[]];
    assert.deepEqual(allNames, names);
    // addresses returned by read might need normalization or deepEqual check
    assert.equal(allAddresses.length, addresses.length);
    assert.equal(allAddresses[0].toLowerCase(), addresses[0].toLowerCase());

    // Check getContractNames
    const storedNames = await manifest.read.getContractNames();
    assert.deepEqual(storedNames, names);

    // Check hubChatRewards convenience getter
    const hubChatRewardsAddr = (await manifest.read.hubChatRewards()) as string;
    assert.equal(hubChatRewardsAddr.toLowerCase(), addresses[2].toLowerCase());
  });
});
