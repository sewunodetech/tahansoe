// Copies the Guardian ABIs from the Foundry build into lib/contracts/.
// Run `forge build` in contracts/ first.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GUARDIANS = [
  { contract: "TahansoeGuardian", exportName: "guardianAbi", file: "guardian-abi.ts" },
  { contract: "TahansoeGuardianV2", exportName: "guardianV2Abi", file: "guardian-v2-abi.ts" },
];

for (const { contract, exportName, file } of GUARDIANS) {
  const source = `contracts/out/${contract}.sol/${contract}.json`;
  const artifact = fileURLToPath(new URL(`../../../${source}`, import.meta.url));
  const target = fileURLToPath(new URL(`../lib/contracts/${file}`, import.meta.url));

  const { abi } = JSON.parse(readFileSync(artifact, "utf8"));
  writeFileSync(
    target,
    `// Generated from ${source} (\`forge build\` in contracts/).\n` +
      "// Regenerate after changing the contract: npm run abi -w @tahansoe/web\n" +
      `export const ${exportName} = ${JSON.stringify(abi, null, 2)} as const;\n`
  );
  console.log(`Wrote ${abi.length} ABI entries to lib/contracts/${file}`);
}
