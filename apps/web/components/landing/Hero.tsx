import { ParticleMesh } from "./ParticleMesh";
import { HeroCopy } from "./HeroCopy";
import { HFCard } from "./HFCard";
import { ProtocolStrip } from "./ProtocolStrip";

/**
 * Minimal Web3 hero.
 *
 * Layers (back to front):
 *   1. ParticleMesh canvas — subtle texture, mouse-reactive, opacity 0.3
 *   2. Single radial glow — top-center, very soft
 *   3. Bottom fade — smooth transition into next section
 *   4. Content — z-10
 */
export function Hero() {
  return (
    <section
      className="relative min-h-[100dvh] flex flex-col overflow-hidden"
      style={{ background: "#0b1110" }}
    >
      {/* Particle mesh — texture only, not the star */}
      <ParticleMesh />

      {/* Single centered glow — the only decoration */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% -5%, rgba(253,241,225,0.07) 0%, transparent 100%)",
        }}
      />

      {/* Teal accent glow — brand color wash */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 55% 40% at 20% 60%, rgba(74,181,224,0.07) 0%, transparent 70%)",
        }}
      />

      {/* Amber accent glow — secondary, right side */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 40% 30% at 85% 40%, rgba(251,191,36,0.05) 0%, transparent 70%)",
        }}
      />

      {/* Bottom fade into next section */}
      <div
        className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            "linear-gradient(to bottom, transparent, #0b1110)",
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col max-w-[1280px] mx-auto w-full px-6 md:px-12 pt-[140px] pb-20">

        {/* Main split */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-12 items-center">
          <HeroCopy />
          <div className="hidden lg:flex items-center justify-end">
            <HFCard />
          </div>
        </div>

        {/* Protocol strip */}
        <ProtocolStrip />
      </div>
    </section>
  );
}
