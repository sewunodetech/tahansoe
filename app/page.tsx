import { Navbar } from "@/components/landing/Navbar";
import { SpotlightHero } from "@/components/landing/SpotlightHero";
import { HealthFactorExplainer } from "@/components/landing/HealthFactorExplainer";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Features } from "@/components/landing/Features";
import { Architecture } from "@/components/landing/Architecture";
import { FAQ } from "@/components/landing/FAQ";
import { RiskDisclosure } from "@/components/landing/RiskDisclosure";
import { WaitlistCTA } from "@/components/landing/WaitlistCTA";
import { Footer } from "@/components/landing/Footer";
import { MossBand } from "@/components/landing/Scenery";

export default function Home() {
  return (
    <>
      <Navbar />
      <main className="bg-[#0b1110]">
        <SpotlightHero />
        <HealthFactorExplainer />
        <MossBand />
        <HowItWorks />
        <Features />
        <MossBand />
        <Architecture />
        <FAQ />
        <RiskDisclosure />
        <WaitlistCTA />
      </main>
      <Footer />
    </>
  );
}
