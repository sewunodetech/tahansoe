/**
 * Illustrative borrow-position model for the landing "Position lab".
 * Numbers are examples for teaching, not live protocol parameters.
 */
export const LAB = {
  collateralEth: 2,
  lt: 0.83, // liquidation threshold (example, close to WETH on Aave V3 Arbitrum)
  startPrice: 3200,
  startDebt: 3200,
  trigger: 1.3,
  target: 1.6,
  wallet: 450, // Layer 1 reserve, USDC
  vault: 650, // Layer 2 reserve, USDC value of vault shares
  flashCost: 0.0055, // flash fee + max swap slippage
  liqBonus: 0.05, // liquidation penalty paid to the liquidator
  closeFactor: 0.5,
  minPrice: 1200,
  maxPrice: 4200,
} as const;

export type LayerIndex = 0 | 1 | 2;

export type LabEvent = {
  id: number;
  kind: "layer" | "liquidation";
  layer?: LayerIndex;
  amount: number; // USDC repaid
  hfAfter: number;
  price: number;
  extra?: number; // L3: ETH swapped · liquidation: penalty in USD
};

export type LabState = {
  price: number;
  collateral: number; // ETH
  debt: number; // USDC
  wallet: number;
  vault: number;
  swappedEth: number;
  repaid: [number, number, number]; // USDC repaid per layer
  penalty: number; // USD lost to liquidations
  events: LabEvent[];
  seq: number;
};

export function initialState(price: number = LAB.startPrice): LabState {
  return {
    price,
    collateral: LAB.collateralEth,
    debt: LAB.startDebt,
    wallet: LAB.wallet,
    vault: LAB.vault,
    swappedEth: 0,
    repaid: [0, 0, 0],
    penalty: 0,
    events: [],
    seq: 0,
  };
}

export function healthFactor(s: Pick<LabState, "collateral" | "price" | "debt">): number {
  if (s.debt <= 0.0001) return Infinity;
  return (s.collateral * s.price * LAB.lt) / s.debt;
}

export type HfStatus = "safe" | "warning" | "critical" | "liquidatable";

/** Same mapping as DESIGN.md §2: safe above trigger + 0.25, critical at or below trigger. */
export function hfStatus(hf: number): HfStatus {
  if (hf < 1) return "liquidatable";
  if (hf <= LAB.trigger) return "critical";
  if (hf <= LAB.trigger + 0.25) return "warning";
  return "safe";
}

/**
 * Move the price and let the rules react: layers fire in order (cheapest first)
 * until HF is back at target; anything still below 1 gets liquidated.
 */
export function step(prev: LabState, price: number, layersOn: readonly boolean[]): LabState {
  const s: LabState = { ...prev, price, repaid: [...prev.repaid] };
  const push = (e: Omit<LabEvent, "id">) => {
    s.seq += 1;
    s.events = [{ ...e, id: s.seq }, ...s.events].slice(0, 12);
  };

  if (healthFactor(s) < LAB.trigger) {
    // Repay needed so (C·p·LT) / (D − r) = target.
    let need = s.debt - (s.collateral * s.price * LAB.lt) / LAB.target;

    if (layersOn[0] && need > 0 && s.wallet > 0.5) {
      const r = Math.min(need, s.wallet);
      s.wallet -= r;
      s.repaid[0] += r;
      s.debt -= r;
      need -= r;
      push({ kind: "layer", layer: 0, amount: r, hfAfter: healthFactor(s), price });
    }
    if (layersOn[1] && need > 0.5 && s.vault > 0.5) {
      const r = Math.min(need, s.vault);
      s.vault -= r;
      s.repaid[1] += r;
      s.debt -= r;
      need -= r;
      push({ kind: "layer", layer: 1, amount: r, hfAfter: healthFactor(s), price });
    }
    if (layersOn[2] && need > 0.5) {
      // Selling collateral also lowers collateral value, so solve for r directly:
      // (C·p − r·k)·LT = T·(D − r)  →  r = (T·D − C·p·LT) / (T − k·LT)
      const k = 1 + LAB.flashCost;
      const r = (LAB.target * s.debt - s.collateral * s.price * LAB.lt) / (LAB.target - k * LAB.lt);
      if (r > 0) {
        const eth = (r * k) / s.price;
        s.collateral -= eth;
        s.debt -= r;
        s.swappedEth += eth;
        s.repaid[2] += r;
        push({ kind: "layer", layer: 2, amount: r, hfAfter: healthFactor(s), price, extra: eth });
      }
    }
  }

  // Liquidation: a bot repays part of the debt and takes collateral plus a bonus.
  for (let i = 0; i < 4 && healthFactor(s) < 1 && s.debt > 1; i++) {
    const repaid = s.debt * LAB.closeFactor;
    const seizedEth = Math.min(s.collateral, (repaid * (1 + LAB.liqBonus)) / s.price);
    const loss = repaid * LAB.liqBonus;
    s.debt -= repaid;
    s.collateral -= seizedEth;
    s.penalty += loss;
    push({ kind: "liquidation", amount: repaid, hfAfter: healthFactor(s), price, extra: loss });
  }

  return s;
}

/** ETH price at which HF would hit 1.00 with today's collateral and debt. */
export function liquidationPrice(s: Pick<LabState, "collateral" | "debt">): number {
  return s.collateral > 0 ? s.debt / (s.collateral * LAB.lt) : Infinity;
}

export const LAYER_NAMES = ["Wallet reserve", "Position reserve", "Flash deleverage"] as const;
