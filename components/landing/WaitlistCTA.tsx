"use client";

import { useState } from "react";

export function WaitlistCTA() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setError("");
    setSubmitted(true);
  }

  return (
    <section id="waitlist" className="py-20 md:py-[80px] border-t border-[#27272a]">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left: copy */}
          <div>
            <h2 className="text-4xl md:text-5xl font-medium leading-[1.1] tracking-[-0.02em] text-white mb-5">
              Get early access.
            </h2>
            <p className="text-[15px] leading-[1.6] text-[#a1a1aa] max-w-[420px]">
              Tahansoe is in pre-development. Join the waitlist to be notified when the
              testnet demo goes live.
            </p>
          </div>

          {/* Right: form */}
          <div>
            {submitted ? (
              <div className="rounded-[8px] border border-[#27272a] bg-[#18181b] px-8 py-7">
                <div className="flex items-center gap-3 mb-2">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle cx="8" cy="8" r="7" stroke="#22c55e" strokeWidth="1.2" />
                    <path
                      d="M5 8L7 10L11 6"
                      stroke="#22c55e"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="text-[15px] font-medium text-white">You're on the list.</span>
                </div>
                <p className="text-[13px] text-[#a1a1aa]">
                  We'll reach out when the testnet demo is ready.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <div className="space-y-3">
                  <label className="block">
                    <span className="font-mono text-[11px] tracking-[0.12em] uppercase text-[#71717a] block mb-2">
                      Email address
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (error) setError("");
                      }}
                      placeholder="you@example.com"
                      className="w-full h-11 rounded-[8px] bg-[#18181b] border border-[#27272a] px-4 text-[14px] text-white placeholder:text-[#52525b] outline-none focus:border-[#52525b] transition-colors duration-150"
                    />
                    {error && (
                      <p className="mt-2 text-[12px] text-red-400">{error}</p>
                    )}
                  </label>
                  <button
                    type="submit"
                    className="w-full h-11 rounded-[8px] bg-white text-[#050505] text-[14px] font-semibold tracking-[-0.01em] transition-all duration-150 hover:bg-[#e4e4e7] active:scale-[0.98]"
                  >
                    Join waitlist
                  </button>
                  <p className="text-[11px] text-[#71717a] text-center">
                    No spam. Unsubscribe anytime.
                  </p>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
