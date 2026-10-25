import { parseArgs } from "node:util";
import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import { ARBITRUM_ONE, ARBITRUM_SEPOLIA, type ChainConfig } from "@tahansoe/domain";
import {
  getAgent,
  getClients,
  getReputationSummary,
  filterClientsWithGuardianPolicy,
  prepareRegister,
  buildFeedback,
  type ReputationTag,
} from "../../erc8004/index.ts";
import type { Db } from "@tahansoe/db";
import { EXIT_OK, EXIT_ERROR } from "./args.ts";
import { agentPlansCommand } from "./agent-plans.ts";

export const AGENT_IDENTITY_HELP = `tahansoe agent identity — ERC-8004 Identity and Reputation Manager (ADR 0017)

Usage:
  tahansoe agent identity <subcommand> [options]

Subcommands:
  show              Show on-chain agent identity and Sybil-filtered reputation
  prepare-register  Generate unsigned calldata for agent registration (dry-run)
  prepare-feedback  Generate unsigned calldata for settlement feedback (dry-run)

Options:
  --agent-id <id>     Agent ID (default: 1)
  --chain <name>      Target chain: sepolia | one (default: sepolia)
  --rpc <url>         Custom RPC URL
  --uri <url>         Agent registration file URI (for prepare-register)
  --outcome <tag>     Settlement outcome: protection | preempt | false-positive | missed (for prepare-feedback)
  --value <val>       Feedback score value override (for prepare-feedback)
  --feedback-uri <uri> Off-chain feedback log URI (for prepare-feedback)
  --json              Output machine-readable JSON
  --help, -h          Show this help message`;

export interface AgentCommandDeps {
  db?: Db;
  client?: PublicClient;
  chainConfig?: ChainConfig;
  stdout?: (msg: string) => void;
  stderr?: (msg: string) => void;
}

function asString(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

export function resolveChain(chainName?: string, rpcUrl?: string): {
  chainConfig: ChainConfig;
  client: PublicClient;
} {
  const isOne = chainName?.toLowerCase() === "one" || chainName?.toLowerCase() === "arbitrum-one";
  const chainConfig = isOne ? ARBITRUM_ONE : ARBITRUM_SEPOLIA;
  const viemChain = isOne ? arbitrum : arbitrumSepolia;

  const defaultRpc = isOne
    ? process.env.ARB_ONE_RPC_URL || "https://arb1.arbitrum.io/rpc"
    : process.env.ARB_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";

  const transportUrl = rpcUrl || defaultRpc;
  const client = createPublicClient({
    chain: viemChain,
    transport: http(transportUrl),
  });

  return { chainConfig, client };
}

const IDENTITY_SUBCOMMANDS = new Set(["identity", "show", "prepare-register", "prepare-feedback"]);

export const AGENT_HELP = `tahansoe agent — Protection Strategy Agent

Usage:
  tahansoe agent plans [options]               Recent Protection Agent plans (shadow log)
  tahansoe agent identity <subcommand> [opts]  ERC-8004 identity and reputation (ADR 0017)

Run "tahansoe agent plans --help" or "tahansoe agent identity --help" for details.`;

/** Entry `tahansoe agent`: `plans` (spec §3.2–3.3) dan `identity` (ADR 0017). */
export async function agentCommand(argv: string[], deps: AgentCommandDeps = {}): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));
  const sub = argv[0];

  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    writeOut(AGENT_HELP + "\n");
    return EXIT_OK;
  }
  if (sub === "plans") {
    return agentPlansCommand(argv.slice(1), deps);
  }
  if (IDENTITY_SUBCOMMANDS.has(sub)) {
    return agentIdentityCommand(argv, deps);
  }
  writeErr(`subcommand agent tidak dikenal: ${sub}\n\n${AGENT_HELP}\n`);
  return EXIT_ERROR;
}

export async function agentIdentityCommand(
  argv: string[],
  deps: AgentCommandDeps = {}
): Promise<number> {
  const stdout = deps.stdout ?? ((m: string) => process.stdout.write(m + "\n"));
  const stderr = deps.stderr ?? ((m: string) => process.stderr.write(m + "\n"));

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        "agent-id": { type: "string" },
        chain: { type: "string" },
        rpc: { type: "string" },
        uri: { type: "string" },
        outcome: { type: "string" },
        value: { type: "string" },
        "feedback-uri": { type: "string" },
      },
      allowPositionals: true,
    });
  } catch (err) {
    stderr(`[agent] invalid arguments: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_ERROR;
  }

  if (Boolean(parsed.values.help)) {
    stdout(AGENT_IDENTITY_HELP);
    return EXIT_OK;
  }

  const positionals = parsed.positionals;
  // Support both "tahansoe agent identity <subcommand>" and "tahansoe agent <subcommand>"
  let subcommand = positionals[0];
  if (subcommand === "identity") {
    subcommand = positionals[1];
  }

  if (!subcommand) {
    stdout(AGENT_IDENTITY_HELP);
    return EXIT_OK;
  }

  const chainArg = asString(parsed.values.chain);
  const rpcArg = asString(parsed.values.rpc);
  const { chainConfig: defaultChainConfig, client: defaultClient } = resolveChain(
    chainArg,
    rpcArg
  );
  const chainConfig = deps.chainConfig ?? defaultChainConfig;
  const client = deps.client ?? defaultClient;
  const isJson = Boolean(parsed.values.json);

  const agentIdStr = asString(parsed.values["agent-id"]);
  const agentId = agentIdStr ? BigInt(agentIdStr) : (chainConfig.erc8004?.agentId ?? 0n);

  switch (subcommand) {
    case "show": {
      const agent = await getAgent(client, chainConfig, agentId);
      if (!agent) {
        if (isJson) {
          stdout(JSON.stringify({ registered: false, agentId: agentId.toString(), chain: chainConfig.name }, null, 2));
        } else {
          stdout(`Agent ID: ${agentId}`);
          stdout(`Chain:    ${chainConfig.name} (${chainConfig.chainId})`);
          stdout(`Status:   Not registered yet`);
          stdout(`Tip:      Run "tahansoe agent identity prepare-register" to prepare registration calldata.`);
        }
        return EXIT_OK;
      }

      // Read reputation clients and filter through Sybil filter
      let rawClients: Address[] = [];
      let filteredClients: Address[] = [];
      let summary = { count: 0n, summaryValue: 0n, summaryValueDecimals: 0 };

      try {
        rawClients = await getClients(client, chainConfig, agentId);
        filteredClients = await filterClientsWithGuardianPolicy(client, chainConfig, rawClients);
        summary = await getReputationSummary(client, chainConfig, agentId, filteredClients);
      } catch {
        // Reputation registry queries may fail gracefully if not populated
      }

      if (isJson) {
        stdout(
          JSON.stringify(
            {
              registered: true,
              agentId: agent.agentId.toString(),
              owner: agent.owner,
              agentWallet: agent.agentWallet,
              agentURI: agent.agentURI,
              chain: chainConfig.name,
              chainId: chainConfig.chainId,
              reputation: {
                count: summary.count.toString(),
                summaryValue: summary.summaryValue.toString(),
                summaryValueDecimals: summary.summaryValueDecimals,
                totalClients: rawClients.length,
                filteredClientsCount: filteredClients.length,
                filteredClients,
              },
            },
            null,
            2
          )
        );
      } else {
        stdout("=== Tahansoe Protection Agent (ERC-8004 Identity) ===");
        stdout(`Agent ID:     ${agent.agentId}`);
        stdout(`Chain:        ${chainConfig.name} (ID ${chainConfig.chainId})`);
        stdout(`Owner:        ${agent.owner}`);
        stdout(`Agent Wallet: ${agent.agentWallet}`);
        stdout(`Agent URI:    ${agent.agentURI}`);
        stdout("");
        stdout("=== Reputation Summary (Sybil-Filtered) ===");
        stdout(`Verified Feedbacks: ${summary.count}`);
        stdout(`Summary Value:      ${summary.summaryValue} (decimals: ${summary.summaryValueDecimals})`);
        stdout(`Total Clients:      ${rawClients.length} (Verified Policyholders: ${filteredClients.length})`);
      }
      return EXIT_OK;
    }

    case "prepare-register": {
      const agentURI = asString(parsed.values.uri);
      if (!agentURI) {
        stderr("prepare-register: --uri <https URL of the hosted registration file> is required");
        return EXIT_ERROR;
      }

      const tx = prepareRegister({ agentURI, chainConfig });

      if (isJson) {
        stdout(
          JSON.stringify(
            {
              subcommand: "prepare-register",
              agentURI,
              to: tx.to,
              data: tx.data,
              chain: chainConfig.name,
              chainId: chainConfig.chainId,
            },
            null,
            2
          )
        );
      } else {
        stdout("=== ERC-8004 Agent Registration (Unsigned Calldata) ===");
        stdout(`Target Contract: ${tx.to} (Identity Registry on ${chainConfig.name})`);
        stdout(`Function:        register(string agentURI)`);
        stdout(`Agent URI:       ${agentURI}`);
        stdout(`Calldata:        ${tx.data}`);
        stdout("");
        stdout("Note: Dry-run only. No transaction was signed or submitted.");
      }
      return EXIT_OK;
    }

    case "prepare-feedback": {
      const outcomeTag = (asString(parsed.values.outcome) || "protection") as ReputationTag;
      const feedbackURI = asString(parsed.values["feedback-uri"]) || "";
      const valStr = asString(parsed.values.value);
      const scoreValue = valStr ? BigInt(valStr) : undefined;

      const call = buildFeedback(
        {
          agentId,
          tag: outcomeTag,
          value: scoreValue,
          feedbackURI,
          chainConfig,
        },
        chainConfig
      );

      if (isJson) {
        stdout(
          JSON.stringify(
            {
              subcommand: "prepare-feedback",
              agentId: call.agentId.toString(),
              to: call.to,
              data: call.data,
              tag1: call.tag1,
              tag2: call.tag2,
              value: call.value.toString(),
              valueDecimals: call.valueDecimals,
              endpoint: call.endpoint,
              feedbackURI: call.feedbackURI,
              feedbackHash: call.feedbackHash,
              chain: chainConfig.name,
              chainId: chainConfig.chainId,
            },
            null,
            2
          )
        );
      } else {
        stdout("=== ERC-8004 Give Feedback (Unsigned Calldata) ===");
        stdout(`Target Contract: ${call.to} (Reputation Registry on ${chainConfig.name})`);
        stdout(`Function:        giveFeedback(...)`);
        stdout(`Agent ID:        ${call.agentId}`);
        stdout(`Tag 1 (Outcome): ${call.tag1}`);
        stdout(`Tag 2:           ${call.tag2}`);
        stdout(`Value:           ${call.value} (decimals: ${call.valueDecimals})`);
        stdout(`Endpoint:        ${call.endpoint || "(none)"}`);
        stdout(`Feedback URI:    ${call.feedbackURI || "(none)"}`);
        stdout(`Feedback Hash:   ${call.feedbackHash}`);
        stdout(`Calldata:        ${call.data}`);
        stdout("");
        stdout("Note: Dry-run only. No transaction was signed or submitted.");
      }
      return EXIT_OK;
    }

    default:
      stderr(`[agent] unknown subcommand: ${subcommand}\n\n${AGENT_IDENTITY_HELP}`);
      return EXIT_ERROR;
  }
}
