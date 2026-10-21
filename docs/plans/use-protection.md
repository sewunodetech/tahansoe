# useProtection Hook API Specification

The `useProtection` hook is the unified abstraction layer for Tahansoe liquidation protection state and actions. In Phase 3 (dashboard infrastructure), it sources live reactive data and user policies from `SimulationContext`. In Phase 5, it connects to on-chain smart contracts without requiring changes to consuming dashboard UI components.

## Import

```tsx
import { useProtection } from "@/hooks/useProtection";
import type { RiskZone, ProtectionLayer, ProtectionLayers, ProtectionActions, UseProtectionReturn } from "@/hooks/useProtection";
```

## Signature

```tsx
function useProtection(preferredPositionId?: string): UseProtectionReturn
```

## Return Value Properties

| Property | Type | Description |
|---|---|---|
| `position` | `Position \| null` | The currently selected/primary position (Aave V3, etc.). |
| `positions` | `Position[]` | All active positions monitored by the account. |
| `selectedPositionId` | `string` | The ID of the currently active position. |
| `setSelectedPositionId` | `(id: string) => void` | Select a different position to inspect/configure. |
| `hf` | `number` | Health Factor of the selected position (e.g. `1.82`). |
| `zone` | `RiskZone` | Risk zone category: `"Safe"` \| `"Watch"` \| `"Warning"` \| `"Critical"`. |
| `layers` | `ProtectionLayers` | Configuration and readiness for each of the 3 protection layers (`l1`, `l2`, `l3`). |
| `policy` | `PolicySettings` | The full user policy settings object (thresholds, caps, notifications). |
| `activity` | `HistoryEntry[]` | Audit trail of past executions, remediations, and status checks. |
| `actions` | `ProtectionActions` | Interactive mutation functions for layers, caps, approvals, policies, and simulation. |
| `isPaused` | `boolean` | Whether simulation engine ticker is currently paused. |
| `ethPrice` | `{ price: number; change24h: number }` | Current simulated ETH/USD oracle price and 24h change. |

---

## 3 Protection Layers Structure (`layers`)

`layers.l1`, `layers.l2`, and `layers.l3` each implement `ProtectionLayer`:

```typescript
export interface ProtectionLayer {
  layer: 1 | 2 | 3;
  name: string;        // "Wallet Reserve", "Position Reserve", "Flash Deleverage"
  asset: string;       // "USDC", "Vault Shares / aToken", "Aave Flash Loan"
  enabled: boolean;    // Whether user activated this layer in policy
  approved: boolean;   // Whether token allowance/authorization is granted
  capacity: number;    // Approved cap amount in USD
  coversPct: number;   // Percentage of debt/repay buffer covered by this layer (0-100)
  description: string; // Plain-English operational description
}
```

- **Layer 1 (Wallet Reserve)**: Hot wallet USDC allowance. Cascades first.
- **Layer 2 (Position Reserve)**: ERC-4626 vault shares or secondary aToken position. Cascades second.
- **Layer 3 (Flash Deleverage)**: Atomic flash borrow -> debt repay -> collateral withdrawal -> swap. Cascades third.

---

## Actions API (`actions`)

```typescript
export interface ProtectionActions {
  /** Enable or disable a specific layer (1, 2, or 3) */
  enableLayer: (layer: 1 | 2 | 3, enabled: boolean) => void;

  /** Set the approved capacity limit for a layer in USD */
  setCap: (layer: 1 | 2 | 3, cap: number) => void;

  /** Simulate approving token spending/authorizations for a layer */
  approve: (layer: 1 | 2 | 3) => void;

  /** Revoke authorization and set capacity to 0 for a layer */
  revoke: (layer: 1 | 2 | 3) => void;

  /** Revoke all authorizations across all three layers atomically */
  revokeAll: () => void;

  /** Patch general policy settings (triggerHF, targetHF, slippageBps, etc.) */
  setPolicy: (patch: Partial<PolicySettings>) => void;

  /** Set trigger Health Factor threshold (default: 1.30) */
  setTriggerHf: (trigger: number) => void;

  /** Set target Health Factor after remediation (default: 1.60) */
  setTargetHf: (target: number) => void;

  /** Simulate an instant market drop (default: 15%) to test cascade execution */
  simulatePriceDrop: (percent?: number) => void;

  /** Reset simulation positions, prices, and history to defaults */
  resetSimulation: () => void;

  /** Pause or resume the live simulation tick interval */
  setPaused: (paused: boolean) => void;
}
```

---

## Example Usage

```tsx
import { useProtection } from "@/hooks/useProtection";
import { Button, StatusPill, LayerBadge } from "@/components/ui";

export function ProtectionStatusCard() {
  const { hf, zone, layers, actions } = useProtection();

  return (
    <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Current HF: {hf.toFixed(2)}</span>
        <StatusPill zone={zone} />
      </div>

      <div className="mt-4 flex gap-2">
        <LayerBadge layer={1} />
        <span>{layers.l1.enabled ? `Ready ($${layers.l1.capacity})` : "Disabled"}</span>
      </div>

      <div className="mt-4 flex gap-2">
        <Button variant="danger" size="sm" onClick={() => actions.revokeAll()}>
          Revoke All
        </Button>
        <Button variant="secondary" size="sm" onClick={() => actions.simulatePriceDrop(15)}>
          Simulate 15% Drop
        </Button>
      </div>
    </div>
  );
}
```
