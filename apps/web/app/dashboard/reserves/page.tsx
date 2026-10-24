"use client";

import React from "react";
import { LivePage } from "@/components/dashboard/live/live-page";
import { ReservesView } from "@/components/dashboard/reserves/reserves-view";

export default function ReservesPage() {
  return (
    <LivePage
      eyebrow="Layer 2 Source"
      title="Position Reserves"
      subtitle="Yield-bearing vault shares and aTokens configured to repay debt if Layer 1 runs out."
    >
      <ReservesView />
    </LivePage>
  );
}
