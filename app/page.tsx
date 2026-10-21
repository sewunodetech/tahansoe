import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { HealthFactorExplainer } from "@/components/landing/HealthFactorExplainer";
import { ProtectionLayers } from "@/components/landing/ProtectionLayers";
import { Agents } from "@/components/landing/Agents";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Supported } from "@/components/landing/Supported";
import { OpenByDefault } from "@/components/landing/OpenByDefault";
import { FAQ } from "@/components/landing/FAQ";
import { RiskDisclosure } from "@/components/landing/RiskDisclosure";
import { CTA } from "@/components/landing/CTA";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--text-primary)] transition-colors">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <HealthFactorExplainer />
        <ProtectionLayers />
        <Agents />
        <HowItWorks />
        <Supported />
        <OpenByDefault />
        <FAQ />
        <RiskDisclosure />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
