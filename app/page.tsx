import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { ProtectionLayers } from "@/components/landing/ProtectionLayers";
import { Agents } from "@/components/landing/Agents";
import { OpenByDefault } from "@/components/landing/OpenByDefault";
import { FAQ } from "@/components/landing/FAQ";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
  return (
    <div className="relative min-h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      <Navbar />
      <main>
        <Hero />
        <ProtectionLayers />
        <Agents />
        <OpenByDefault />
        <FAQ />
      </main>
      <Footer />
    </div>
  );
}
