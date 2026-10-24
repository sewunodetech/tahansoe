/**
 * Contract deployment onto a fresh fork. One interface, two strategies:
 *
 * 1. `contracts/script/DeploySim.s.sol` (preferred). Run with forge against the fork;
 *    the script prints `SIM_DEPLOYMENT {"guardian":"0x…","simPriceFeed":"0x…","testVault":"0x…"}`.
 * 2. Artifact fallback, used while DeploySim has not landed: deploy TahansoeGuardianV2
 *    and SimPriceFeed (and TestVault, if built) straight from `contracts/out` bytecode.
 *    Requires `forge build` to have produced those artifacts.
 *
 * Both deploy from one fixed simnet deployer (nonce reset to 0 on every fork), so
 * addresses are deterministic across forks (spec §3.2). The deployer key is a public,
 * simnet-only key with no value on any real chain; it is also the SimPriceFeed updater.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  encodeDeployData,
  getAddress,
  isAddress,
  keccak256,
  parseEther,
  toBytes,
  type Abi,
  type AbiParameter,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SIM_FEED_DECIMALS } from "./abis.ts";
import { FORK_SOURCE, GUARDIAN_SWAP_FEE, UNISWAP_SWAP_ROUTER_02 } from "./config.ts";
import type { ForkClient } from "./fork-client.ts";
import { toHex } from "./rpc.ts";

const execFileAsync = promisify(execFile);

/** Public, simnet-only deployer key (derived from a fixed label; holds nothing on real chains). */
export const SIM_DEPLOYER_KEY: Hex = keccak256(toBytes("tahansoe.simnet.deployer.v1"));
export const SIM_DEPLOYER: Address = privateKeyToAccount(SIM_DEPLOYER_KEY).address;

export interface SimDeployment {
  guardian: Address;
  simPriceFeed: Address;
  testVault?: Address;
  /** Account allowed to call SimPriceFeed.setAnswer. */
  updater: Address;
  method: "deploy-sim-script" | "artifacts";
}

export interface Deployer {
  deploy(fork: ForkClient): Promise<SimDeployment>;
}

export interface DeployerOptions {
  contractsDir?: string;
  forgeBin: string;
  simChainId: number;
}

export function defaultContractsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../contracts");
}

/** Parses the `SIM_DEPLOYMENT {json}` line printed by DeploySim.s.sol. */
export function parseDeploymentOutput(stdout: string): Omit<SimDeployment, "updater" | "method"> | null {
  const m = stdout.match(/SIM_DEPLOYMENT\s+(\{[^\n]*\})/);
  if (!m?.[1]) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const addr = (v: unknown) => (typeof v === "string" && isAddress(v, { strict: false }) ? getAddress(v) : undefined);
  const guardian = addr(raw.guardian);
  const simPriceFeed = addr(raw.simPriceFeed);
  if (!guardian || !simPriceFeed) return null;
  const testVault = addr(raw.testVault);
  return testVault ? { guardian, simPriceFeed, testVault } : { guardian, simPriceFeed };
}

async function prepareDeployer(fork: ForkClient): Promise<void> {
  await fork.rpc("anvil_setNonce", [SIM_DEPLOYER, "0x0"]);
  await fork.setBalance(SIM_DEPLOYER, parseEther("1000"));
}

export function createDeployer(opts: DeployerOptions): Deployer {
  const contractsDir = opts.contractsDir ?? defaultContractsDir();
  return {
    async deploy(fork) {
      await prepareDeployer(fork);
      if (existsSync(join(contractsDir, "script", "DeploySim.s.sol"))) {
        return deployWithScript(fork, contractsDir, opts);
      }
      return deployFromArtifacts(fork, contractsDir);
    },
  };
}

async function deployWithScript(fork: ForkClient, contractsDir: string, opts: DeployerOptions): Promise<SimDeployment> {
  const { stdout } = await execFileAsync(
    opts.forgeBin,
    [
      "script", "script/DeploySim.s.sol:DeploySim",
      "--rpc-url", fork.url,
      "--private-key", SIM_DEPLOYER_KEY,
      "--broadcast",
    ],
    {
      cwd: contractsDir,
      env: { ...process.env, SIM_CHAIN_ID: String(opts.simChainId) },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 180_000,
    },
  );
  const parsed = parseDeploymentOutput(stdout);
  if (!parsed) throw new Error("DeploySim.s.sol ran but printed no valid SIM_DEPLOYMENT line");
  return { ...parsed, updater: SIM_DEPLOYER, method: "deploy-sim-script" };
}

interface Artifact {
  abi: Abi;
  bytecode: { object: Hex };
}

function loadArtifact(contractsDir: string, name: string): Artifact | null {
  const p = join(contractsDir, "out", `${name}.sol`, `${name}.json`);
  if (!existsSync(p)) return null;
  const a = JSON.parse(readFileSync(p, "utf8")) as Artifact;
  return a.bytecode?.object && a.bytecode.object !== "0x" ? a : null;
}

/**
 * Builds constructor args for a contract whose constructor we only know from its ABI.
 * Used for SimPriceFeed/TestVault in the fallback path, where Task A owns the source.
 */
export function guessConstructorArgs(abi: Abi, hints: { initialAnswer: bigint; updater: Address; asset?: Address }) {
  const ctor = abi.find((x) => x.type === "constructor") as { inputs?: readonly AbiParameter[] } | undefined;
  return (ctor?.inputs ?? []).map((input) => {
    const name = (input.name ?? "").toLowerCase();
    if (input.type === "address") return name.includes("asset") || name.includes("token") ? hints.asset ?? hints.updater : hints.updater;
    if (input.type === "uint8") return SIM_FEED_DECIMALS;
    if (input.type.startsWith("int") || input.type.startsWith("uint")) return hints.initialAnswer;
    if (input.type === "string") return name.includes("symbol") ? "vSIM" : "Tahansoe Sim";
    throw new Error(`cannot guess constructor arg ${input.name}: ${input.type}`);
  });
}

async function deployRaw(fork: ForkClient, data: Hex): Promise<Address> {
  await fork.rpc("anvil_impersonateAccount", [SIM_DEPLOYER]);
  try {
    const hash = await fork.rpc<Hex>("eth_sendTransaction", [{ from: SIM_DEPLOYER, data, gas: toHex(30_000_000) }]);
    const receipt = await fork.client.waitForTransactionReceipt({ hash, pollingInterval: 100 });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deploy tx ${hash} failed`);
    return getAddress(receipt.contractAddress);
  } finally {
    await fork.rpc("anvil_stopImpersonatingAccount", [SIM_DEPLOYER]).catch(() => undefined);
  }
}

async function deployFromArtifacts(fork: ForkClient, contractsDir: string): Promise<SimDeployment> {
  const guardianArt = loadArtifact(contractsDir, "TahansoeGuardianV2");
  const feedArt = loadArtifact(contractsDir, "SimPriceFeed");
  if (!guardianArt || !feedArt) {
    throw new Error(
      `no DeploySim.s.sol and missing artifacts in ${join(contractsDir, "out")} ` +
        "(need TahansoeGuardianV2 and SimPriceFeed; run `forge build` in contracts/)",
    );
  }
  const initialAnswer = 2_000n * 10n ** BigInt(SIM_FEED_DECIMALS);
  const simPriceFeed = await deployRaw(
    fork,
    encodeDeployData({
      abi: feedArt.abi,
      bytecode: feedArt.bytecode.object,
      args: guessConstructorArgs(feedArt.abi, { initialAnswer, updater: SIM_DEPLOYER }),
    } as never),
  );
  const guardian = await deployRaw(
    fork,
    encodeDeployData({
      abi: guardianArt.abi,
      bytecode: guardianArt.bytecode.object,
      args: [FORK_SOURCE.poolAddressesProvider, UNISWAP_SWAP_ROUTER_02, GUARDIAN_SWAP_FEE],
    } as never),
  );
  const vaultArt = loadArtifact(contractsDir, "TestVault");
  const testVault = vaultArt
    ? await deployRaw(
        fork,
        encodeDeployData({
          abi: vaultArt.abi,
          bytecode: vaultArt.bytecode.object,
          args: guessConstructorArgs(vaultArt.abi, { initialAnswer, updater: SIM_DEPLOYER, asset: FORK_SOURCE.usdc }),
        } as never),
      )
    : undefined;
  return { guardian, simPriceFeed, ...(testVault ? { testVault } : {}), updater: SIM_DEPLOYER, method: "artifacts" };
}
