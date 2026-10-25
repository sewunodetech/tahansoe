/**
 * CLI command `tahansoe backtest protection [--scenario id] [--json]`.
 * (spec m4-protection-strategy-agent §3.5, PRD §6.4).
 */

import { parseArgs } from "node:util";
import {
  defaultDeciderRegistry,
  loadAllScenarios,
  loadScenario,
  passesReleaseGate,
  renderComparisonTable,
  runBacktestSuite,
} from "../../backtest/index.ts";
import { EXIT_ERROR, EXIT_OK, flagOrNpm } from "./args.ts";

export const BACKTEST_HELP = `tahansoe backtest — Protection strategy backtest harness

Usage:
  tahansoe backtest protection [options]

Options:
  --scenario <id>       Run a specific scenario (e.g. aug-2024-yen-carry, calm-2024-july)
  --candidate <id>      Candidate decider from registry (default: dynamic)
  --active <id>         Active baseline decider from registry (default: static)
  --json                Emit machine-readable JSON on stdout
  --help, -h            Show this help message
`;

function jsonBigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export async function backtestCommand(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        scenario: { type: "string" },
        candidate: { type: "string" },
        active: { type: "string" },
        "no-color": { type: "boolean" },
      },
      allowPositionals: true,
    });
  } catch (err) {
    process.stderr.write(`Error parsing arguments: ${err instanceof Error ? err.message : String(err)}\n\n${BACKTEST_HELP}\n`);
    return EXIT_ERROR;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(BACKTEST_HELP + "\n");
    return EXIT_OK;
  }

  const subCommand = positionals[0] ?? "protection";
  if (subCommand !== "protection") {
    process.stderr.write(`Unknown backtest subcommand: ${subCommand}. Available: protection\n\n${BACKTEST_HELP}\n`);
    return EXIT_ERROR;
  }

  const isJson = flagOrNpm(values.json, "json");
  const candidateId = values.candidate ?? "dynamic";
  const activeId = values.active ?? "static";

  const candidateDecider = defaultDeciderRegistry.get(candidateId);
  if (!candidateDecider) {
    process.stderr.write(`Candidate decider "${candidateId}" not found in registry. Available: ${defaultDeciderRegistry.list().join(", ")}\n`);
    return EXIT_ERROR;
  }

  const activeDecider = defaultDeciderRegistry.get(activeId);
  if (!activeDecider) {
    process.stderr.write(`Active decider "${activeId}" not found in registry. Available: ${defaultDeciderRegistry.list().join(", ")}\n`);
    return EXIT_ERROR;
  }

  // Load scenarios
  let scenarios;
  try {
    if (values.scenario) {
      scenarios = [loadScenario(values.scenario)];
    } else {
      scenarios = loadAllScenarios();
    }
  } catch (err) {
    process.stderr.write(`Error loading scenarios: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }

  if (scenarios.length === 0) {
    process.stderr.write("No scenarios found to backtest.\n");
    return EXIT_ERROR;
  }

  try {
    const candidateReport = await runBacktestSuite(scenarios, candidateDecider, candidateId);
    const activeReport = await runBacktestSuite(scenarios, activeDecider, activeId);
    const gateResult = passesReleaseGate(candidateReport, activeReport);

    if (isJson) {
      process.stdout.write(
        JSON.stringify(
          {
            candidate: candidateReport,
            active: activeReport,
            gate: gateResult,
          },
          jsonBigIntReplacer,
          2
        ) + "\n"
      );
    } else {
      process.stdout.write(renderComparisonTable(candidateReport, activeReport, gateResult) + "\n");
    }

    return EXIT_OK;
  } catch (err) {
    process.stderr.write(`Backtest execution failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }
}
