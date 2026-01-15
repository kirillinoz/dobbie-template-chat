
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatIgnition from "@nomicfoundation/hardhat-ignition-viem";

const config = {
  solidity: "0.8.28",
  plugins: [hardhatViem, hardhatIgnition],
  paths: {
    tests: "./sovereign-test",
  }
};

export default config;
    