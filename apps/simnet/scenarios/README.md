# Simulation Replay Scenario Fixtures

Historical price trajectory fixtures for the Tahansoe simulation network (`apps/simnet`).

These fixtures power the **Replay mode** on Arbitrum One Anvil forks ([ADR 0014](../../docs/decisions/0014-simulation-network-anvil-fork.md), [spec simulation mode](../../docs/specs/m1-simulation-mode.md) §3.3). Calon users can test their borrow positions and protection layers against accelerated replays of real historical market crashes.

---

## 1. Fixture Format

Each scenario is stored as a single, compact JSON file adhering strictly to the following schema:

```json
{
  "id": "aug-2024-yen-carry",
  "title": "August 2024 Yen Carry Trade Unwind",
  "description": "Bank of Japan interest rate hikes sparked an unwind of global yen carry trades, triggering severe risk-off crypto spot selloffs and perp liquidation cascades.",
  "source": "binance:ETHUSDT",
  "normalized": false,
  "points": [
    { "t": 1722729600, "price": 2905.2 },
    { "t": 1722729900, "price": 2908.75 }
  ]
}
```

### Fields Specification

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique kebab-case scenario identifier matching the filename. |
| `title` | `string` | Human-readable scenario title. |
| `description` | `string` | 1–2 factual English sentences providing market context from the catalog without exaggeration. |
| `source` | `string` | Public data source identifier (e.g. `binance:ETHUSDT`, `coinbase:ETH-USD`). |
| `normalized` | `boolean` | `true` if prices must be scaled to the fork's starting oracle price by simnet; `false` if raw historical prices are used. |
| `points` | `Array<{t, price}>` | Chronological list of price points, strictly sorted by `t` ascending. Capped at $\le 600$ points per fixture. |
| `points[].t` | `number` | Unix timestamp in seconds (integer). |
| `points[].price` | `number` | ETH price in USD (float rounded to 2 decimal places). |

---

## 2. Included Scenarios

Scenarios are selected from the historical event catalog in [`docs/knowledge/risk-transmission.md`](../../docs/knowledge/risk-transmission.md) §3:

| Scenario ID | Window (UTC) | Points | Price Range (USD) | Normalized | Transmission Paths |
|---|---|---|---|---|---|
| `aug-2024-yen-carry` | 2024-08-04 00:00 $\rightarrow$ 2024-08-06 00:00 | 577 | $2,176.06 – $2,931.64 | `false` | T1 (Price drop), T3 (Perp liquidation cascades) |
| `oct-2025-tariff-crash` | 2025-10-10 12:00 $\rightarrow$ 2025-10-11 12:00 | 289 | $3,500.60 – $4,386.50 | `false` | T1 (Price drop), T3 (Perp cascades), T6 (Gas spike) |
| `mar-2020-black-thursday` | 2020-03-11 00:00 $\rightarrow$ 2020-03-13 23:59 | 433 | $88.35 – $203.04 | `true` | T1 (Price drop), T6 (Gas congestion), T8 (Oracle lag) |

### Scenario Details

1. **`aug-2024-yen-carry` (`aug-2024-yen-carry.json`):**
   - **Context:** Bank of Japan policy rate hikes initiated a rapid unwind of global yen carry trades. The resulting macro risk-off sentiment led to sharp spot selloffs and massive perpetual futures liquidations across centralized exchanges.
   - **Metrics:** 577 points at 5-minute intervals. Starts at $2,905.20, reaches a trough of $2,176.06, and ends at $2,425.48.

2. **`oct-2025-tariff-crash` (`oct-2025-tariff-crash.json`):**
   - **Context:** Sudden US–China trade tariff escalation announcements triggered one of the largest perpetual contract liquidation cascades in crypto history alongside network gas surges, severely depressing collateral values within 24 hours.
   - **Metrics:** 289 points at 5-minute intervals. Starts at $4,347.69, hits a low of $3,500.60, and ends at $3,833.92.

3. **`mar-2020-black-thursday` (`mar-2020-black-thursday.json`):**
   - **Context:** The outbreak of global COVID-19 panic caused an unprecedented multi-day market crash coupled with extreme Ethereum gas congestion that prevented MakerDAO liquidation keepers from bidding effectively.
   - **Normalization Note:** Because Arbitrum One and Aave V3 did not exist in March 2020, `normalized` is set to `true`. Simnet scales this price series relative to the initial fork starting price (`price_sim(t) = P_0 * (price_historical(t) / price_historical(0))`) during scenario playback.
   - **Metrics:** 864 raw 5-minute points downsampled by a factor of 2 to 433 points ($\le 600$). Preserves both the peak ($203.04) and crash trough ($88.35).

---

## 3. Data Sources and Fallbacks

All data is obtained from free, unauthenticated (no API key required) public market data endpoints:

1. **Primary Source:** Binance Public Market Data REST API
   - Endpoint: `https://api.binance.com/api/v3/klines`
   - Market: `ETHUSDT` (spot)
   - Interval: 5 minutes (`5m`)
   - Status: All three scenarios were retrieved directly and completely from Binance without gaps or rate limits.

2. **Fallback Source:** Coinbase Exchange Public REST API
   - Endpoint: `https://api.exchange.coinbase.com/products/ETH-USD/candles`
   - Market: `ETH-USD` (spot)
   - Granularity: 300 seconds (`300`)
   - Automatically invoked by the build script if Binance returns an error or empty payload.

> **Zero Fabrication Policy:** Prices are strictly downloaded from public exchange trade records. Under no circumstances are mock or synthetic price points fabricated.

---

## 4. How to Regenerate

To regenerate all scenario fixtures from the repository root:

```bash
npx tsx apps/simnet/scripts/build-scenarios.ts
```

The script will:
1. Connect to the public APIs and download full candle datasets for each window.
2. Downsample datasets exceeding 600 points using uniform stride sampling while retaining range boundaries and extrema.
3. Validate each fixture against the strict schema and monotonic timestamp assertion.
4. Serialize and write compact JSON files to `apps/simnet/scenarios/`.

---

## 5. Licensing and Attribution

The historical candlestick data contained in these fixtures represents publicly recorded transaction prices on spot orderbooks operated by Binance and Coinbase. 

This data is used solely for non-commercial simulation, automated risk modeling, backtesting, and educational demonstration within the Tahansoe open-source project. Market price figures are factual historical records and do not contain proprietary intellectual property or personally identifiable information.
