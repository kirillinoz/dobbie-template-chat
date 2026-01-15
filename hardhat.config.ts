import 'dotenv/config';
import type { HardhatUserConfig } from 'hardhat/config';
import { configVariable } from 'hardhat/config';

import hardhatViem from '@nomicfoundation/hardhat-viem';
import hardhatIgnition from '@nomicfoundation/hardhat-ignition-viem';

const plugins = [hardhatViem, hardhatIgnition];

const config: HardhatUserConfig = {
  plugins: plugins,
  solidity: {
    profiles: {
      default: {
        version: '0.8.28',
        settings: {
          metadata: {
            bytecodeHash: 'none',
          },
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      production: {
        version: '0.8.28',
        settings: {
          metadata: {
            bytecodeHash: 'none',
          },
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: 'edr-simulated',
      chainType: 'l1',
    },
    hardhatOp: {
      type: 'edr-simulated',
      chainType: 'op',
    },
    sepolia: {
      type: 'http',
      chainType: 'l1',
      url: configVariable('RPC_URL'),
      accounts: [configVariable('WALLET_KEY')],
    },
  },
};

export default config;
