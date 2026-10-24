import Link from "next/link";
import { Tag } from "./Tag";
import { HowSteps, type HowStep } from "./HowSteps";

const steps: HowStep[] = [
  {
    icon: "connect",
    title: "Connect",
    body: "Sign in with your wallet. We find your Aave position on Arbitrum.",
    details: [
      "Sign-In with Ethereum: one signature, no password, no email, and no transaction.",
      "Tahansoe reads your public Aave position (collateral, debt, Health Factor). Nothing is moved.",
    ],
  },
  {
    icon: "choose",
    title: "Choose layers",
    body: "Pick your trigger and target HF, then which layers to turn on.",
    details: [
      "Trigger = when to act (for example HF 1.30). Target = where to bring HF back (for example 1.60).",
      "Turn on any of the three layers: wallet reserve, position reserve, flash deleverage. They always run in that order.",
    ],
  },
  {
    icon: "approve",
    title: "Approve",
    body: "Grant each layer a capped allowance. You see exactly what each one allows.",
    details: [
      "Each layer is a separate token approval in your own wallet, with a cap you choose.",
      "Funds stay in your wallet until they are needed, and only ever repay your own debt. Revoke any approval in one click.",
    ],
  },
  {
    icon: "watch",
    title: "Sentinel watches",
    body: "24/7 checks, Telegram alerts, and automatic repay when needed.",
    details: [
      "The HF Sentinel checks your position around the clock and warns you on Telegram as HF approaches your trigger.",
      "Below the trigger, the rules run your layers in order until HF is back at target, then send you a receipt.",
    ],
  },
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

        <HowSteps steps={steps} />

        <div className="mt-12 flex justify-center">
          <Link href="/connect" className="btn-iridescent">Protect my position</Link>
        </div>
      </div>
    </section>
  );
}
