import { network } from 'hardhat';

async function main() {
  const manifestAddress = '0xD4ce62a0f13b23Be8eF9C3d68EF35AD80DC4B3ab';
  console.log(
    `Checking VersionManifest at ${manifestAddress} on ${(network as any).name}...`
  );

  // Fix for 'Property viem does not exist on type NetworkConnection'
  const { viem } = (await network.connect()) as any;

  console.log('Getting contract instance...');
  const manifest = await viem.getContractAt('VersionManifest', manifestAddress);

  console.log('Calling hubChatRewards()...');
  const hubChatRewardsAddr = await manifest.read.hubChatRewards();

  console.log('---------------------------------------------------');
  console.log(`HubChatRewards Address: ${hubChatRewardsAddr}`);
  console.log('---------------------------------------------------');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
