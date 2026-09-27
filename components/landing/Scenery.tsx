/* eslint-disable @next/next/no-img-element -- decorative remote cutout */

/**
 * Scenery pieces that carry the hero's moss-and-glass world into the rest of
 * the page. The moss texture is a seamless tile cut from the hero background's
 * edges (public/scenery/moss-tile.webp); the bowl is the hero's glass cutout.
 */

export const MOSS_TILE = "/scenery/moss-tile.webp";
export const GLASS_BOWL =
  "https://soft-zoom-63098134.figma.site/_assets/v11/3f10f1876e118f72a396e05a6c2d099569478272.png";

const fadeY = "linear-gradient(to bottom, transparent 0%, #000 35%, #000 65%, transparent 100%)";
const fadeUp = "linear-gradient(to bottom, transparent 0%, #000 55%)";

/** A strip of moss that fades in and out, used between sections. */
export function MossBand({ grounded = false, className = "" }: { grounded?: boolean; className?: string }) {
  const mask = grounded ? fadeUp : fadeY;
  return (
    <div
      aria-hidden="true"
      className={`relative h-[140px] md:h-[200px] w-full pointer-events-none ${className}`}
      style={{
        backgroundImage: `url(${MOSS_TILE})`,
        backgroundRepeat: "repeat-x",
        backgroundSize: "auto 100%",
        backgroundPosition: "center bottom",
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  );
}

/**
 * A soft, blurred bed of moss behind a section's content, so glass cards have
 * something to frost over. Place inside a `relative overflow-hidden` section.
 */
export function MossBackdrop({ position = "bottom" }: { position?: "top" | "bottom" }) {
  const mask =
    position === "bottom"
      ? "linear-gradient(to bottom, transparent 0%, #000 55%, #000 80%, transparent 100%)"
      : "linear-gradient(to bottom, transparent 0%, #000 25%, #000 45%, transparent 100%)";
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-x-0 ${position === "bottom" ? "bottom-0" : "top-0"} h-[70%] -z-10 pointer-events-none opacity-45 blur-[2px]`}
      style={{
        backgroundImage: `url(${MOSS_TILE})`,
        backgroundRepeat: "repeat-x",
        backgroundSize: "auto 100%",
        backgroundPosition: `center ${position}`,
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  );
}

/** The hero's glass bowl, resting on moss with a soft glow. */
export function GlassBowl({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`relative pointer-events-none ${className}`}>
      <div className="absolute inset-x-[10%] bottom-[8%] h-[40%] rounded-full bg-[#4ab5e0]/15 blur-3xl" />
      <img src={GLASS_BOWL} alt="" className="relative w-full h-auto object-contain" />
    </div>
  );
}
