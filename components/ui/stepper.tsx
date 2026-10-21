import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepItem {
  title: string;
  description?: string;
}

export interface StepperProps extends React.HTMLAttributes<HTMLDivElement> {
  steps: (StepItem | string)[];
  currentStep: number;
  onStepClick?: (stepIndex: number) => void;
  orientation?: "horizontal" | "vertical";
}

/**
 * Morpho stepper primitive.
 * Multi-step progress indicator used in wizards and onboarding flows.
 */
export function Stepper({
  steps,
  currentStep,
  onStepClick,
  orientation = "horizontal",
  className,
  ...props
}: StepperProps) {
  const isHorizontal = orientation === "horizontal";

  return (
    <div
      className={cn(
        "flex",
        isHorizontal ? "flex-row items-center w-full justify-between" : "flex-col space-y-4",
        className
      )}
      {...props}
    >
      {steps.map((rawStep, index) => {
        const step = typeof rawStep === "string" ? { title: rawStep } : rawStep;
        const isCompleted = index < currentStep;
        const isCurrent = index === currentStep;
        const isUpcoming = index > currentStep;
        const isClickable = onStepClick && isCompleted;

        return (
          <React.Fragment key={index}>
            <div
              className={cn(
                "flex items-center gap-2.5",
                isClickable && "cursor-pointer group"
              )}
              onClick={() => isClickable && onStepClick(index)}
            >
              <div
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-xs font-mono font-medium transition-all shrink-0",
                  isCompleted &&
                    "bg-[var(--brand)] text-white shadow-sm",
                  isCurrent &&
                    "bg-[var(--brand-bg)] text-[var(--brand)] border-2 border-[var(--brand)] ring-4 ring-[var(--brand-glow)]",
                  isUpcoming &&
                    "bg-[var(--bg-elevated)] text-[var(--text-tertiary)] border border-[var(--border)]"
                )}
              >
                {isCompleted ? <Check className="size-3.5 stroke-[2.5]" /> : index + 1}
              </div>

              <div className="flex flex-col min-w-0">
                <span
                  className={cn(
                    "text-xs font-medium leading-none truncate transition-colors",
                    isCurrent
                      ? "text-[var(--text-primary)] font-semibold"
                      : isCompleted
                      ? "text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]"
                      : "text-[var(--text-tertiary)]"
                  )}
                >
                  {step.title}
                </span>
                {step.description && (
                  <span className="text-[10px] text-[var(--text-tertiary)] truncate mt-0.5">
                    {step.description}
                  </span>
                )}
              </div>
            </div>

            {isHorizontal && index < steps.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-[1.5px] mx-3 transition-colors",
                  index < currentStep ? "bg-[var(--brand)]" : "bg-[var(--border)]"
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
