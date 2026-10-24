"use client";

import React from "react";
import { LivePage } from "@/components/dashboard/live/live-page";
import { HoldingsView } from "@/components/dashboard/holdings/holdings-view";

export default function HoldingsPage() {
  return (
    <LivePage
      eyebrow="Holdings"
      title="Wallet holdings"
      subtitle="Hot wallet assets and Guardian allowances available for automated debt repayment."
    >
      <HoldingsView />
    </LivePage>
  );
}
