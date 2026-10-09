import { getDb, riskAssessments, researchReports } from "@tahansoe/db";
import { desc } from "drizzle-orm";
import { withTransientRetry } from "./src/db/store.ts";

const db = getDb();
const raRows = await withTransientRetry(() =>
  db
    .select({ id: riskAssessments.id, asset: riskAssessments.asset, regime: riskAssessments.regime, createdAt: riskAssessments.createdAt })
    .from(riskAssessments)
    .orderBy(desc(riskAssessments.createdAt))
    .limit(10),
);
console.log("latest risk_assessments rows:");
for (const r of raRows) console.log(`  ${r.createdAt?.toISOString?.() ?? r.createdAt}  ${r.asset}  ${r.regime}  ${r.id}`);
console.log(`count-ra: ${raRows.length}`);

try {
  const url = `${process.env.LLM_API_URL}/models`;
  console.log("fetching:", url.replace(/https?:\/\/[^@]+@/, ""));
  const r = await fetch(url, {
    headers: { authorization: `Bearer ${process.env.LLM_API_KEY}` },
  });
  console.log("models status:", r.status);
} catch (err: any) {
  console.error("models error:", err.message, err.cause);
}

process.exit(0);
