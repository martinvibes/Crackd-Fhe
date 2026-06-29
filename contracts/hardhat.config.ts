import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-network-helpers";
import "@typechain/hardhat";
import "@fhevm/hardhat-plugin";
import * as dotenv from "dotenv";

dotenv.config();

const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.public.blastapi.io";
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // fhEVM requires Cancun for the coprocessor precompiles.
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    localhost: { url: "http://127.0.0.1:8545" },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: ADMIN_PRIVATE_KEY ? [ADMIN_PRIVATE_KEY] : [],
      chainId: 11155111,
      // Cap the gas price so the upfront balance requirement stays low on a
      // lightly-funded deployer. Override with GAS_PRICE_GWEI if Sepolia spikes.
      gasPrice: Math.round(Number(process.env.GAS_PRICE_GWEI || "55") * 1e9),
    },
  },
};

export default config;
