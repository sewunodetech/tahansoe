import { AnimatePresence, motion } from "motion/react";
import { LAB, healthFactor, liquidationPrice, type LabState, type LayerIndex } from "./model";

export type Part = "collateral" | "debt" | "hf" | "l1" | "l2" | "l3";

export const PARTS: { id: Part; short: string }[] = [
  { id: "collateral", short: "Collateral" },
  { id: "debt", short: "Debt" },
  { id: "hf", short: "Health Factor" },
  { id: "l1", short: "L1 Wallet" },
  { id: "l2", short: "L2 Vault" },
  { id: "l3", short: "L3 Flash" },
];

export const LAYER_OF: Partial<Record<Part, LayerIndex>> = { l1: 0, l2: 1, l3: 2 };

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const hfText = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "∞");

type Entry = {
  eyebrow: string;
  title: string;
  what: string;
  why: string;
  stats: (s: LabState) => [string, string][];
};

const ENTRIES: Record<Part, Entry> = {
  collateral: {
    eyebrow: "Your asset",
    title: "Collateral",
    what: "The ETH you deposited on Aave. It backs your loan, but Aave only counts part of its value: the liquidation threshold. That counted value is the height of this block.",
    why: "When ETH falls, this block shrinks while your debt stays the same. That is how a safe loan becomes a risky one.",
    stats: (s) => [
      ["Amount", `${s.collateral.toFixed(3)} ETH`],
      ["Market value", usd(s.collateral * s.price)],
      [`Counted (× ${LAB.lt})`, usd(s.collateral * s.price * LAB.lt)],
    ],
  },
  debt: {
    eyebrow: "What you owe",
    title: "Debt",
    what: "The USDC you borrowed against your collateral. It does not move with the ETH price.",
    why: "Every Tahansoe layer protects you the same way: by repaying part of this debt so the ratio gets healthy again.",
    stats: (s) => [
      ["Debt now", usd(s.debt)],
      ["Repaid by layers", usd(s.repaid[0] + s.repaid[1] + s.repaid[2])],
      ["Started at", usd(LAB.startDebt)],
    ],
  },
  hf: {
    eyebrow: "The number that matters",
    title: "Health Factor",
    what: "Counted collateral divided by debt. Above 1.00 your loan is open; at 1.00 anyone can liquidate it and keep a penalty.",
    why: `Tahansoe acts at your trigger (${LAB.trigger.toFixed(2)}), well before 1.00, and repays just enough to bring HF back to your target (${LAB.target.toFixed(2)}).`,
    stats: (s) => [
      ["Health Factor", hfText(healthFactor(s))],
      ["Trigger / target", `${LAB.trigger.toFixed(2)} / ${LAB.target.toFixed(2)}`],
      ["Liquidated if ETH ≤", usd(liquidationPrice(s))],
    ],
  },
  l1: {
    eyebrow: "Layer 1 · acts first",
    title: "Wallet reserve",
    what: "USDC you keep in your own wallet. You approve a capped amount; it never leaves your wallet except to repay your own debt.",
    why: "Cheapest defence: gas only. Tahansoe takes exactly what is needed, never more than your cap.",
    stats: (s) => [
      ["Left", usd(s.wallet)],
      ["Used to repay", usd(s.repaid[0])],
      ["Cost", "Gas only"],
    ],
  },
  l2: {
    eyebrow: "Layer 2 · if L1 runs out",
    title: "Position reserve",
    what: "Shares of another DeFi position you already hold, such as a Morpho vault. Only the shares needed are redeemed into USDC.",
    why: "Your money keeps earning until the moment it is needed, then it repays your debt in the same transaction.",
    stats: (s) => [
      ["Left", usd(s.vault)],
      ["Used to repay", usd(s.repaid[1])],
      ["Cost", "Gas + any vault exit fee"],
    ],
  },
  l3: {
    eyebrow: "Layer 3 · last resort",
    title: "Flash deleverage",
    what: "A flash loan repays part of your debt, then a slice of your collateral is swapped to pay it back. All in one transaction, or nothing happens.",
    why: "Works even with no reserves left. You end with less ETH but a healthier loan, and avoid the liquidator's penalty.",
    stats: (s) => [
      ["ETH swapped", `${s.swappedEth.toFixed(3)} ETH`],
      ["Debt repaid", usd(s.repaid[2])],
      ["Cost", `~${(LAB.flashCost * 100).toFixed(2)}% (fee + max slippage)`],
    ],
  },
};

export function Inspector({
  part,
  state,
  layersOn,
  onSelect,
  onToggle,
}: {
  part: Part;
  state: LabState;
  layersOn: readonly boolean[];
  onSelect: (p: Part) => void;
  onToggle: (i: LayerIndex) => void;
}) {
  const e = ENTRIES[part];
  const layer = LAYER_OF[part];

  return (
    <div className="px-1 sm:px-2 pb-1">
      <div role="tablist" aria-label="Inspect a part of the position" className="flex flex-wrap gap-1.5">
        {PARTS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === part}
            onClick={() => onSelect(p.id)}
            className={`rounded-full border px-3 py-1 text-[11.5px] transition-colors duration-200 ${
              p.id === part
                ? "border-[var(--brand)] text-[var(--text-primary)] bg-[var(--bg-elevated)]"
                : "border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {p.short}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={part}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="mt-4"
          role="tabpanel"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--brand)]">{e.eyebrow}</p>
              <p className="mt-1 font-display uppercase text-[22px] leading-tight text-[var(--text-primary)]">{e.title}</p>
            </div>
            {layer !== undefined && (
              <button
                type="button"
                onClick={() => onToggle(layer)}
                aria-pressed={layersOn[layer]}
                className="btn-ghost-soft !h-8 !px-3 !text-[11.5px] shrink-0"
              >
                {layersOn[layer] ? "Turn this layer off" : "Turn this layer on"}
              </button>
            )}
          </div>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{e.what}</p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-primary)]">{e.why}</p>
          <dl className="mt-4 grid grid-cols-3 gap-px rounded-[14px] overflow-hidden border border-[var(--border)] bg-[var(--border)]">
            {e.stats(state).map(([k, v]) => (
              <div key={k} className="bg-[var(--bg-elevated)] px-3 py-2.5">
                <dt className="text-[10.5px] uppercase tracking-[0.05em] text-[var(--text-tertiary)]">{k}</dt>
                <dd className="mt-1 font-mono text-[13px] tabular-nums text-[var(--text-primary)]">{v}</dd>
              </div>
            ))}
          </dl>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
