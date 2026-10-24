import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { TheProblem } from "@/components/landing/TheProblem";
import { PositionLab } from "@/components/landing/lab/PositionLab";
import { ProtectionLayers } from "@/components/landing/ProtectionLayers";
import { Compare } from "@/components/landing/Compare";
import { Agents } from "@/components/landing/Agents";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { OpenByDefault } from "@/components/landing/OpenByDefault";
import { FAQ } from "@/components/landing/FAQ";
import { Footer } from "@/components/landing/Footer";
import { GeoDefs } from "@/components/landing/geo/Defs";

export default function Home() {
  return (
    <div className="relative min-h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      <GeoDefs />
      <Navbar />
      <main>
        <Hero />
        <PositionLab />
        <TheProblem />
        <ProtectionLayers />
        <Compare />
        <Agents />
        <HowItWorks />
        <OpenByDefault />
        <FAQ />
      </main>
      <Footer />
    </div>
  );
}
