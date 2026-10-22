/**
 * Every number in the simulation lives here. All values are mock parameters
 * chosen to be close to Aave V3 / Morpho on Arbitrum, not live market data.
 */

export const BTC_PRICE_0 = 100_000;        // mock oracle price, USD
export const FAUCET_BTC = 1;               // "1 mock BTC" from the board

export const LIQ_THRESHOLD = 0.78;         // BTC liquidation threshold (Aave V3 WBTC-like)
export const MAX_LTV = 0.73;               // borrow cap as share of collateral value
export const LIQ_PENALTY = 0.075;          // liquidation bonus paid to the liquidator
export const CLOSE_FACTOR = 0.5;           // share of debt a liquidator may repay per hit

export const TRIGGER_HF = 1.3;             // Tahansoe acts below this
export const TARGET_HF = 1.6;              // Tahansoe restores to this
export const FLASH_LOAN_FEE = 0.0005;      // 0.05%
export const SWAP_SLIPPAGE = 0.003;        // 0.30% when selling collateral

export const LENDER_SUPPLY = 100_000;      // USDT the lender brings to the pool
export const LENDER_APY = 0.1;             // "want 10% of fee"
export const PROTOCOL_SPREAD = 0.01;       // borrower pays lender rate + spread
export const BORROWER_FIXED_RATE = LENDER_APY + PROTOCOL_SPREAD;

/** Borrowing past this would start the position below Tahansoe's trigger. */
export const POLICY_MAX_LTV = Math.floor((LIQ_THRESHOLD / TRIGGER_HF) * 100) / 100;

export const DEFAULT_LTV = 0.2;            // "want 20% of their BTC become USDT"
export const DEFAULT_MONTHLY_PAYMENT = 500;

/** Share of collateral yield swept to debt; the rest builds Tahansoe's guard reserve. */
export const SWEEP_TO_DEBT = 0.8;
export const SWEEP_TO_RESERVE = 1 - SWEEP_TO_DEBT;

export const TERMS = [
  { days: 90, label: "90 days" },
  { days: 180, label: "180 days" },
  { days: 365, label: "1 year" },
] as const;

export type VenueId = "lending" | "lst" | "basis";

export const YIELD_VENUES: {
  id: VenueId;
  name: string;
  apy: number;
  risk: "Low" | "Medium" | "Higher";
  how: string;
}[] = [
  {
    id: "lending",
    name: "BTC lending market",
    apy: 0.02,
    risk: "Low",
    how: "Locked BTC is supplied to a separate BTC lending market. Borrowers of BTC pay the interest.",
  },
  {
    id: "lst",
    name: "BTC staking / restaking",
    apy: 0.04,
    risk: "Medium",
    how: "Locked BTC is wrapped into a liquid staking token that secures other networks and pays staking rewards.",
  },
  {
    id: "basis",
    name: "Delta-neutral basis",
    apy: 0.07,
    risk: "Higher",
    how: "Locked BTC is held spot while a matching perp short collects funding. Price exposure cancels; funding is the yield.",
  },
];

export type ScenarioId = "dip" | "bear" | "crash";

export const SCENARIOS: { id: ScenarioId; name: string; blurb: string }[] = [
  { id: "dip", name: "Weekend dip −25%", blurb: "A normal drawdown. Tahansoe should stay idle." },
  { id: "bear", name: "Bear market −55%", blurb: "A deep, slow bleed over weeks." },
  { id: "crash", name: "Crash through liquidation", blurb: "Price falls 10% below your liquidation price." },
];

export const STATIONS = [
  { id: "faucet", short: "Mock BTC", title: "Get 1 mock BTC" },
  { id: "supply", short: "Collateral", title: "Supply BTC as collateral" },
  { id: "lender", short: "Lender", title: "A lender brings USDT" },
  { id: "borrow", short: "Borrow", title: "Borrow USDT against BTC" },
  { id: "fixed", short: "Fixed rate", title: "Lock a fixed rate" },
  { id: "yield", short: "Yield", title: "Put the locked BTC to work" },
  { id: "time", short: "Time machine", title: "Let yield repay the loan" },
  { id: "guard", short: "Tahansoe guard", title: "Survive a crash with Tahansoe" },
  { id: "receipt", short: "Receipt", title: "Your journey" },
] as const;

export type StationId = (typeof STATIONS)[number]["id"];
