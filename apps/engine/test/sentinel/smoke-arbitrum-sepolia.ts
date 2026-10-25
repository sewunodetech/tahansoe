import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { ARBITRUM_SEPOLIA } from "@tahansoe/domain";
import { getGuardiansForChain, createGuardianAdaptersForChain } from "../../src/sentinel/adapters.ts";
import { guardianAaveV4Abi } from "../../src/sentinel/abi.ts";

async function main() {
  console.log("=== ARBITRUM SEPOLIA GUARDIAN DISCOVERY & SMOKE RUN ===");
  const guardians = getGuardiansForChain(ARBITRUM_SEPOLIA);
  console.log("Discovered guardians:", JSON.stringify(guardians, null, 2));

  const client = createPublicClient({
    chain: arbitrumSepolia,
    transport: http("https://sepolia-rollup.arbitrum.io/rpc"),
  });

  const adapters = createGuardianAdaptersForChain(ARBITRUM_SEPOLIA, { client });
  console.log(`Created ${adapters.length} adapters:`);
  for (const a of adapters) {
    console.log(` - Adapter v${a.version} (${a.protocol}) at ${a.guardianAddress}`);
  }

  const v4 = guardians.find((g) => g.version === 4);
  if (!v4) {
    throw new Error("Guardian v4 not found in discovery!");
  }

  console.log("Querying positionCount on Guardian v4 at", v4.address, "...");
  const count = await client.readContract({
    address: v4.address,
    abi: guardianAaveV4Abi,
    functionName: "positionCount",
  });
  console.log("positionCount result:", count.toString());

  const v4Adapter = adapters.find((a) => a.version === 4);
  if (v4Adapter) {
    const positions = await v4Adapter.getPositions();
    console.log(`v4Adapter.getPositions() returned ${positions.length} positions.`);
  }

  console.log("Smoke run completed successfully!");
}

main().catch((err) => {
  console.error("Smoke run error:", err);
  process.exit(1);
});
