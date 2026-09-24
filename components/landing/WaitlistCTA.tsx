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
    <section id="waitlist" className="py-20 md:py-[80px] border-t border-[#26332f]">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left: copy */}
          <div>
            <h2 className="text-4xl md:text-5xl font-display font-medium leading-[1.1] tracking-[-0.02em] text-[#fdf1e1] mb-5">
              Get early access.
            </h2>
            <p className="text-[15px] leading-[1.6] text-[#c8bca9] max-w-[420px]">
              Tahansoe is in pre-development. Join the waitlist to be notified when the
              testnet demo goes live.
            </p>
          </div>

          {/* Right: form */}
          <div>
            {submitted ? (
              <div className="rounded-[24px] border border-[#fdf1e1]/10 bg-[#15201d] px-8 py-7">
                <div className="flex items-center gap-3 mb-2">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle cx="8" cy="8" r="7" stroke="#4ab5e0" strokeWidth="1.2" />
                    <path
                      d="M5 8L7 10L11 6"
                      stroke="#4ab5e0"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="text-[15px] font-medium text-[#fdf1e1]">You&apos;re on the list.</span>
                </div>
                <p className="text-[13px] text-[#c8bca9]">
                  We&apos;ll reach out when the testnet demo is ready.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <div className="space-y-3">
                  <label className="block">
                    <span className="text-[12px] font-medium tracking-[0.08em] uppercase text-[#4ab5e0] block mb-2 pl-5">
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
                      className="w-full h-12 rounded-full bg-[#15201d] border border-[#26332f] px-5 text-[14px] text-[#fdf1e1] placeholder:text-[#5b6660] outline-none focus:border-[#5b6660] transition-colors duration-150"
                    />
                    {error && (
                      <p className="mt-2 text-[12px] text-[#f87171] pl-5">{error}</p>
                    )}
                  </label>
                  <button
                    type="submit"
                    className="w-full h-12 rounded-full bg-[#fdf1e1] text-[#111411] text-[14px] font-semibold tracking-[-0.01em] transition-all duration-150 hover:bg-[#f0e2cc] active:scale-[0.98]"
                  >
                    Join waitlist
                  </button>
                  <p className="text-[11px] text-[#8f897c] text-center">
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
