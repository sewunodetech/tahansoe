import type { AmountPreset } from "@/components/ui/amount-presets";

/**
 * Quick-fill caps for the demo layer inputs, in USD. "Recommended" is the repay needed to
 * lift HF from the trigger back to the target: debt × (1 − trigger / target), the same rule
 * the live form uses (recommendedRepayBase in @tahansoe/domain).
 */
export function demoCapPresets(debtUsd: number, triggerHf: number, targetHf: number): AmountPreset<number>[] {
  const presets: AmountPreset<number>[] = [];
  if (targetHf > triggerHf && debtUsd > 0) {
    presets.push({
      label: "Recommended",
      value: Math.ceil(debtUsd * (1 - triggerHf / targetHf)),
      hint: "Repay needed to lift HF from the trigger back to the target",
    });
  }
  for (const pct of [25, 50, 100]) {
    presets.push({ label: `${pct}% of debt`, value: Math.round((debtUsd * pct) / 100) });
  }
  return presets;
}
