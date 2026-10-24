"use client";

import React from "react";
import { PageHeader } from "@/components/dashboard/page-header";

export interface LivePageProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/** Page frame for live-mode dashboard pages: the shared header, then the page body. */
export function LivePage({ eyebrow, title, subtitle, children }: LivePageProps) {
  return (
    <div className="w-full p-5 md:p-8 space-y-6">
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      {children}
    </div>
  );
}
