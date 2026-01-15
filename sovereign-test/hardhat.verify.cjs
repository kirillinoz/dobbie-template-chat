
      require("@nomicfoundation/hardhat-toolbox");
      module.exports = {
        solidity: "0.8.27",
        paths: {
          // Inside the container, we will be at /app, and tests will be in /app/sovereign-test
          tests: "./sovereign-test",
        }
      };
    