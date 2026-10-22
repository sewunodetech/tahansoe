// Copies the TahansoeGuardian ABI from the Foundry build into lib/contracts/guardian-abi.ts.
// Run `forge build` in contracts/ first.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const artifact = fileURLToPath(new URL("../../../contracts/out/TahansoeGuardian.sol/TahansoeGuardian.json", import.meta.url));
const target = fileURLToPath(new URL("../lib/contracts/guardian-abi.ts", import.meta.url));

const { abi } = JSON.parse(readFileSync(artifact, "utf8"));
writeFileSync(
  target,
  "// Generated from contracts/out/TahansoeGuardian.sol/TahansoeGuardian.json (`forge build` in contracts/).\n" +
    "// Regenerate after changing the contract: npm run abi -w @tahansoe/web\n" +
    `export const guardianAbi = ${JSON.stringify(abi, null, 2)} as const;\n`
);
console.log(`Wrote ${abi.length} ABI entries to lib/contracts/guardian-abi.ts`);
