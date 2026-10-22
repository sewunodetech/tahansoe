import { useEffect, useRef, useState } from "react";
import { STATIONS, type StationId } from "../sim/constants";
import { useSim } from "../sim/store";
import { STATION_VIEWS } from "../stations";
import { cx } from "./ui";

const WIDTH = 500;
const GAP = 14;
const TOP_SAFE = 72;     // below the sticky header
const BOTTOM_SAFE = 84;  // above the floating log dock

function useIsMobile() {
  const query = "(max-width: 767px)";
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}

const anchorFor = (id: StationId) => document.querySelector<HTMLElement>(`[data-target-station="${id}"]`);

/**
 * The selected step's interactive example, floating next to its node on the board.
 * On phones it becomes a bottom sheet instead.
 */
export function ActionPopover() {
  const { state, dispatch } = useSim();
  const station = STATIONS[state.view];
  const View = STATION_VIEWS[station.id];
  const mobile = useIsMobile();
  const box = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);
  const open = state.drawerOpen;

  // Give the popover room: bring the node near the top of the viewport.
  useEffect(() => {
    if (!open || mobile) return;
    const node = anchorFor(station.id);
    if (!node) return;
    const r = node.getBoundingClientRect();
    if (r.top < TOP_SAFE + 8 || r.top > window.innerHeight * 0.4) {
      window.scrollTo({ top: window.scrollY + r.top - TOP_SAFE - 24, behavior: "smooth" });
    }
  }, [open, station.id, mobile]);

  // Follow the node every frame (page scroll, board pan, resize) without re-rendering.
  useEffect(() => {
    if (!open || mobile) return;
    let raf = 0;
    const place = () => {
      const el = box.current;
      const node = anchorFor(station.id);
      if (el && node) {
        const r = node.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w = Math.min(WIDTH, vw - 32);
        const rightRoom = vw - r.right - 16;
        const leftRoom = r.left - 16;
        let left: number;
        let top: number;
        let maxH: number;
        let side: "left" | "right" | "below";
        if (rightRoom >= w + GAP) {
          side = "right";
          left = r.right + GAP;
        } else if (leftRoom >= w + GAP) {
          side = "left";
          left = r.left - GAP - w;
        } else {
          side = "below";
          left = Math.min(Math.max(16, r.left + r.width / 2 - w / 2), vw - 16 - w);
        }
        if (side === "below") {
          top = Math.max(TOP_SAFE, r.bottom + GAP);
          maxH = Math.max(260, vh - top - BOTTOM_SAFE);
        } else {
          maxH = vh - TOP_SAFE - BOTTOM_SAFE;
          const h = Math.min(el.offsetHeight || maxH, maxH);
          top = Math.min(Math.max(TOP_SAFE, r.top - 12), vh - BOTTOM_SAFE - h);
        }
        el.style.width = `${w}px`;
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.maxHeight = `${maxH}px`;
        el.dataset.side = side;

        const a = arrow.current;
        if (a) {
          const h = el.offsetHeight;
          if (side === "below") {
            a.style.top = "-7px";
            a.style.left = `${Math.min(Math.max(20, r.left + r.width / 2 - left), w - 20) - 6}px`;
          } else {
            a.style.top = `${Math.min(Math.max(18, r.top + r.height / 2 - top), h - 18) - 6}px`;
            a.style.left = side === "right" ? "-7px" : `${w - 6}px`;
          }
          a.dataset.side = side;
        }
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [open, station.id, mobile]);

  // Clicking empty board space (or anywhere that isn't a control) goes back to the board.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (box.current?.contains(t) || t.closest("button, input, a, [data-keep-popover]")) return;
      dispatch({ type: "CLOSE" });
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, dispatch]);

  if (!open) return null;

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={station.title}
      className={cx(
        "pop-in fixed z-50 flex flex-col border border-line-strong bg-bg-elevated shadow-[0_24px_60px_rgba(0,0,0,0.55)]",
        mobile ? "inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl" : "rounded-2xl",
      )}
      style={mobile ? undefined : { left: -9999, top: 0 }}
    >
      {!mobile && (
        <span
          ref={arrow}
          aria-hidden
          className="popover-arrow absolute h-3 w-3 rotate-45 border-line-strong bg-bg-elevated"
        />
      )}
      <View />
    </div>
  );
}
