export function Footer() {
  return (
    <footer className="border-t border-[#26332f] py-10 bg-[#0b1110]">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <svg width="18" height="18" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path
                d="M11 2L3 5.5V10.5C3 14.72 6.42 18.66 11 20C15.58 18.66 19 14.72 19 10.5V5.5L11 2Z"
                stroke="#4ab5e0"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="M8 11L10.5 13.5L14.5 9"
                stroke="#4ab5e0"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-display text-[28px] leading-none text-[#fdf1e1]">Tahansoe</span>
          </div>

          {/* Links */}
          <nav className="flex flex-wrap gap-6 text-[13px] text-[#8f897c]">
            <a href="#how-it-works" className="hover:text-[#c8bca9] transition-colors duration-150">
              How it works
            </a>
            <a href="#features" className="hover:text-[#c8bca9] transition-colors duration-150">
              Features
            </a>
            <a href="#faq" className="hover:text-[#c8bca9] transition-colors duration-150">
              FAQ
            </a>
            <a href="#risk" className="hover:text-[#c8bca9] transition-colors duration-150">
              Risk disclosure
            </a>
            <a href="#waitlist" className="hover:text-[#c8bca9] transition-colors duration-150">
              Waitlist
            </a>
          </nav>

          {/* Disclaimer */}
          <p className="text-[12px] text-[#5b6660] max-w-[260px] text-right leading-relaxed hidden lg:block">
            Risk automation, not a liquidation guarantee. Use at your own risk.
          </p>
        </div>

        <div className="mt-8 pt-6 border-t border-[#26332f] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <p className="text-[12px] text-[#5b6660]">
            Tahansoe - Pre-development. Testnet only.
          </p>
          <p className="text-[12px] text-[#5b6660]">
            Non-custodial. Smart contract audit pending.
          </p>
        </div>
      </div>
    </footer>
  );
}
