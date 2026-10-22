import type { ComponentType } from "react";
import type { StationId } from "../sim/constants";
import { Borrow } from "./Borrow";
import { Faucet } from "./Faucet";
import { FixedRate } from "./FixedRate";
import { Guard } from "./Guard";
import { Lender } from "./Lender";
import { Receipt } from "./Receipt";
import { Supply } from "./Supply";
import { TimeMachine } from "./TimeMachine";
import { Yield } from "./Yield";

export const STATION_VIEWS: Record<StationId, ComponentType> = {
  faucet: Faucet,
  supply: Supply,
  lender: Lender,
  borrow: Borrow,
  fixed: FixedRate,
  yield: Yield,
  time: TimeMachine,
  guard: Guard,
  receipt: Receipt,
};
