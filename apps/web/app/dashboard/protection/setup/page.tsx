"use client";

import { PageHeader } from "@/components/dashboard/page-header";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useProtection } from "@/hooks/useProtection";
import { Stepper } from "@/components/ui/stepper";
import { Button } from "@/components/ui/button";
import { StepPosition } from "@/components/dashboard/wizard/step-position";
import { StepThresholds } from "@/components/dashboard/wizard/step-thresholds";
import { StepLayer1 } from "@/components/dashboard/wizard/step-layer1";
import { StepLayer2 } from "@/components/dashboard/wizard/step-layer2";
import { StepLayer3 } from "@/components/dashboard/wizard/step-layer3";
import { StepReview } from "@/components/dashboard/wizard/step-review";
import { StepTelegram } from "@/components/dashboard/wizard/step-telegram";
import { useDashboardMode } from "@/lib/dashboard-mode";
import { LivePage } from "@/components/dashboard/live/live-page";
import { LiveProtection } from "@/components/dashboard/live/live-protection";

const WIZARD_STEPS = [
  "Position",
  "Thresholds",
  "Layer 1",
  "Layer 2",
  "Layer 3",
  "Review",
  "Telegram",
];

function DemoProtectionSetupPage() {
  const router = useRouter();
  const { position, hf, ethPrice, policy, actions } = useProtection();

  const [currentStep, setCurrentStep] = useState(0);

  // Draft setup state
  const [triggerHF, setTriggerHF] = useState(policy.triggerHF ?? 1.30);
  const [targetHF, setTargetHF] = useState(policy.targetHF ?? 1.60);
  const [bufferPct, setBufferPct] = useState(policy.bufferPct ?? 10);

  // Layer 1
  const [l1Cap, setL1Cap] = useState(policy.l1Cap ?? 1000);
  const [l1Approved, setL1Approved] = useState(policy.l1Approved ?? true);

  // Layer 2
  const [l2Enabled, setL2Enabled] = useState(policy.l2Enabled ?? true);
  const [l2Source, setL2Source] = useState("Morpho Vault (steakUSDC)");
  const [l2Cap, setL2Cap] = useState(policy.l2Cap ?? 2500);
  const [l2Approved, setL2Approved] = useState(policy.l2Approved ?? true);

  // Layer 3
  const [l3Enabled, setL3Enabled] = useState(policy.l3Enabled ?? true);
  const [l3Cap, setL3Cap] = useState(policy.l3Cap ?? 10000);
  const [slippageBps, setSlippageBps] = useState(policy.slippageBps ?? 50);
  const [l3Approved, setL3Approved] = useState(policy.l3Approved ?? true);

  const [isActivated, setIsActivated] = useState(false);

  const debtUsd = position?.debtUsd ?? 5400;

  const handleActivate = () => {
    actions.setPolicy({
      triggerHF,
      targetHF,
      bufferPct,
      l1Enabled: true,
      l1Approved,
      l1Cap,
      l2Enabled,
      l2Approved,
      l2Cap,
      l3Enabled,
      l3Approved,
      l3Cap,
      slippageBps,
      hotReserveEnabled: true,
      flashLoanEnabled: l3Enabled,
      deleverageEnabled: l3Enabled,
      hasPolicy: true,
    });
    setIsActivated(true);
  };

  const handleComplete = () => {
    router.push("/dashboard");
  };

  return (
    <div className="w-full p-5 md:p-8 space-y-6">
      <PageHeader
        eyebrow="Protection"
        title="Set up protection"
        actions={
          <Button variant="ghost" size="sm" asChild className="text-xs">
            <Link href="/dashboard/protection">
              <ArrowLeft className="size-3.5" /> Back to Protection
            </Link>
          </Button>
        }
      />

      {/* Stepper Progress */}
      <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] overflow-x-auto">
        <Stepper
          steps={WIZARD_STEPS}
          currentStep={currentStep}
          onStepClick={(idx) => idx < currentStep && setCurrentStep(idx)}
        />
      </div>

      {/* Step Render Area */}
      <div>
        {currentStep === 0 && (
          <StepPosition
            position={position}
            hf={hf}
            ethPrice={ethPrice.price}
            onNext={() => setCurrentStep(1)}
          />
        )}

        {currentStep === 1 && (
          <StepThresholds
            currentHF={hf}
            ethPrice={ethPrice.price}
            triggerHF={triggerHF}
            setTriggerHF={setTriggerHF}
            targetHF={targetHF}
            setTargetHF={setTargetHF}
            bufferPct={bufferPct}
            setBufferPct={setBufferPct}
            onNext={() => setCurrentStep(2)}
            onBack={() => setCurrentStep(0)}
          />
        )}

        {currentStep === 2 && (
          <StepLayer1
            cap={l1Cap}
            setCap={setL1Cap}
            approved={l1Approved}
            onApprove={() => setL1Approved(true)}
            debtUsd={debtUsd}
            triggerHF={triggerHF}
            targetHF={targetHF}
            onNext={() => setCurrentStep(3)}
            onBack={() => setCurrentStep(1)}
          />
        )}

        {currentStep === 3 && (
          <StepLayer2
            enabled={l2Enabled}
            setEnabled={setL2Enabled}
            cap={l2Cap}
            setCap={setL2Cap}
            source={l2Source}
            setSource={setL2Source}
            approved={l2Approved}
            onApprove={() => setL2Approved(true)}
            debtUsd={debtUsd}
            triggerHF={triggerHF}
            targetHF={targetHF}
            onNext={() => setCurrentStep(4)}
            onBack={() => setCurrentStep(2)}
          />
        )}

        {currentStep === 4 && (
          <StepLayer3
            enabled={l3Enabled}
            setEnabled={setL3Enabled}
            cap={l3Cap}
            setCap={setL3Cap}
            slippageBps={slippageBps}
            setSlippageBps={setSlippageBps}
            approved={l3Approved}
            onApprove={() => setL3Approved(true)}
            debtUsd={debtUsd}
            onNext={() => setCurrentStep(5)}
            onBack={() => setCurrentStep(3)}
          />
        )}

        {currentStep === 5 && (
          <StepReview
            triggerHF={triggerHF}
            targetHF={targetHF}
            currentHF={hf}
            ethPrice={ethPrice.price}
            l1Cap={l1Cap}
            l1Approved={l1Approved}
            l2Enabled={l2Enabled}
            l2Source={l2Source}
            l2Cap={l2Cap}
            l2Approved={l2Approved}
            l3Enabled={l3Enabled}
            l3Cap={l3Cap}
            slippageBps={slippageBps}
            l3Approved={l3Approved}
            isActivated={isActivated}
            onActivate={handleActivate}
            onNext={() => setCurrentStep(6)}
            onBack={() => setCurrentStep(4)}
          />
        )}

        {currentStep === 6 && (
          <StepTelegram
            onComplete={handleComplete}
          />
        )}
      </div>
    </div>
  );
}

export default function ProtectionSetupPage() {
  const { isLive } = useDashboardMode();
  if (!isLive) return <DemoProtectionSetupPage />;
  return (
    <LivePage eyebrow="Protection" title="Set up Layer 1" subtitle="Two transactions: approve a capped amount, then save the policy.">
      <LiveProtection />
    </LivePage>
  );
}
