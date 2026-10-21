import { Newspaper, Radar } from "lucide-react";
import { Tag } from "./Tag";

const agents = [
  {
    name: "Market Pulse",
    body: "One research run, one brief, sent to every subscriber on Telegram.",
    Icon: Newspaper,
    panel: "brand-panel brand-panel--midnight",
  },
  {
    name: "HF Sentinel",
    body: "Watches your Health Factor and explains every drop. Rules execute, the AI never signs.",
    Icon: Radar,
    panel: "brand-panel",
  },
];

export function Agents() {
  return (
    <section id="agents" className="py-20 md:py-28 bg-[var(--bg-subtle)]">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="flex flex-col items-center text-center">
          <Tag>Agents</Tag>
          <h2 className="mt-4 font-display text-[28px] sm:text-[34px] tracking-[-0.01em] text-[var(--text-primary)]">
            Two agents keeping watch
          </h2>
        </div>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-[760px] mx-auto">
          {agents.map(({ name, body, Icon, panel }) => (
            <div key={name} className={`${panel} aspect-[4/3] flex flex-col justify-between p-6 text-white`}>
              <div className="relative flex-1 flex items-center justify-center">
                <div className="size-14 border border-white/70 flex items-center justify-center bg-white/10">
                  <Icon className="size-6" strokeWidth={1.25} />
                </div>
              </div>
              <div className="relative border-t border-white/25 pt-4">
                <p className="text-[17px]">{name}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-white/80">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
