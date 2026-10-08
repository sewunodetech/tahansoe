export function Footer() {
  return (
    <footer className="py-10 bg-[#0b1110]">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <svg width="26" height="26" viewBox="0 0 270 270" aria-hidden="true">
              <path fill="#fdf1e1" d="M 256 64 L 256 128 L 192.5 128 L 160 95 L 128 64 L 96 95 L 63.5 128 L 64 128 L 128 192 L 128 256 L 64.5 256 L 32 223 L 0 192 L 0 64 L 64 0 L 192 0 Z" />
              <path fill="#4ab5e0" transform="translate(12 12)" d="M 256 192 L 256 256 L 192.5 256 L 160 223 L 128 192 L 128 128 L 192 128 Z" />
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
