"use client";

import { Sparkles, Clock } from "lucide-react";

export default function ChatPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6"
      style={{ background: "var(--bg)" }}>

      {/* Icon */}
      <div
        className="w-14 h-14 rounded-[14px] flex items-center justify-center mb-5"
        style={{
          background: "rgba(129,140,248,0.08)",
          border:     "1px solid rgba(129,140,248,0.18)",
        }}
      >
        <Sparkles style={{ width: 24, height: 24, color: "#818cf8" }} strokeWidth={1.5} />
      </div>

      {/* Badge */}
      <span
        className="inline-flex items-center gap-1.5 h-6 px-3 rounded-full text-[10px] font-semibold font-mono tracking-wider uppercase mb-4"
        style={{
          background: "rgba(129,140,248,0.1)",
          border:     "1px solid rgba(129,140,248,0.2)",
          color:      "#818cf8",
        }}
      >
        <Clock style={{ width: 10, height: 10 }} strokeWidth={2} />
        Coming soon
      </span>

      {/* Title */}
      <h1 className="font-display text-[32px] font-normal text-white leading-tight mb-2 text-center">
        AI Assistant
      </h1>

      {/* Subtitle */}
      <p className="text-[13px] text-white/35 text-center max-w-[360px] leading-relaxed">
        Ask questions about your positions, execution history, and protocol behaviour in plain language.
        Powered by live Tahansoe context.
      </p>

      {/* Feature list */}
      <div className="mt-8 flex flex-col gap-2 w-full max-w-[320px]">
        {[
          "What's my riskiest position right now?",
          "How much would a flash loan repay cost?",
          "Explain my last execution step by step",
          "What happens if ETH drops another 10%?",
        ].map((q) => (
          <div
            key={q}
            className="flex items-center gap-3 px-3.5 py-2.5 rounded-[8px]"
            style={{
              background: "rgba(253,241,225,0.025)",
              border:     "1px solid rgba(253,241,225,0.05)",
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: "rgba(129,140,248,0.4)" }}
            />
            <span className="text-[12px] text-white/30">{q}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
