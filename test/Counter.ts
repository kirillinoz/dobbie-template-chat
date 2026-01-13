import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { network } from 'hardhat';

describe('Counter', async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  it('Should emit the Increment event when calling the inc() function', async function () {
    const counter = await viem.deployContract('Counter');

    const hash = await counter.write.inc();
    await publicClient.waitForTransactionReceipt({ hash });

    const events = await publicClient.getContractEvents({
      address: counter.address,
      abi: counter.abi,
      eventName: 'Increment',
    });

    assert.equal(events.length, 1);
    const args = events[0].args as unknown as { by: bigint };
    assert.equal(args.by, 1n);
  });

  it('The sum of the Increment events should match the current value', async function () {
    const counter = await viem.deployContract('Counter');
    const deploymentBlockNumber = await publicClient.getBlockNumber();

    // run a series of increments
    for (let i = 1n; i <= 10n; i++) {
      await counter.write.incBy([i]);
    }

    const events = await publicClient.getContractEvents({
      address: counter.address,
      abi: counter.abi,
      eventName: 'Increment',
      fromBlock: deploymentBlockNumber,
      strict: true,
    });

    // check that the aggregated events match the current value
    let total = 0n;
    for (const event of events) {
      const args = event.args as unknown as { by: bigint };
      total += args.by;
    }

    assert.equal(total, await counter.read.x());
  });
});
