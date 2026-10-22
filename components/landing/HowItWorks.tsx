import Link from "next/link";
import { Tag } from "./Tag";
import { MiniIcon, type MiniKind } from "./illustrations/MiniIcon";

const steps: { icon: MiniKind; title: string; body: string }[] = [
  { icon: "connect", title: "Connect", body: "Sign in with your wallet. We find your Aave position on Arbitrum." },
  { icon: "choose", title: "Choose layers", body: "Pick your trigger and target HF, then which layers to turn on." },
  { icon: "approve", title: "Approve", body: "Grant each layer a capped allowance. You see exactly what each one allows." },
  { icon: "watch", title: "Sentinel watches", body: "24/7 checks, Telegram alerts, and automatic repay when needed." },
];

export function HowItWorks() {
  return (
    <section id="how" className="py-20 md:py-28">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="flex flex-col items-center text-center">
          <Tag>How it works</Tag>
          <h2 className="mt-4 font-display uppercase text-[32px] sm:text-[40px] leading-[1.1] tracking-[-0.01em] text-[var(--text-primary)]">
            <span className="font-light">Set up in </span>
            <span className="font-semibold">four steps</span>
          </h2>
        </div>

        <ol className="relative mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <div
            aria-hidden="true"
            className="hidden lg:block absolute top-[52px] left-[12%] right-[12%] border-t border-dashed border-[var(--border-strong)]"
          />
          {steps.map((s, i) => (
            <li key={s.title} className="relative flex flex-col items-center text-center">
              <div className="glass-surface rounded-full size-[104px] flex items-center justify-center">
                <MiniIcon kind={s.icon} className="size-20" />
              </div>
              <p className="mt-5 text-[11px] font-mono text-[var(--text-tertiary)]">0{i + 1}</p>
              <p className="mt-1 text-[16px] font-semibold uppercase tracking-[0.02em] text-[var(--text-primary)]">{s.title}</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-secondary)] max-w-[240px]">{s.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-14 flex justify-center">
          <Link href="/connect" className="btn-iridescent">Protect my position</Link>
        </div>
      </div>
    </section>
  );
}
