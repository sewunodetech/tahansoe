# UI Primitives API Reference

This document summarizes the Morpho-styled shared UI primitives in `components/ui/` for Tahansoe. All primitives are token-based, support dark and light themes, and avoid hardcoded hex colors.

All primitives can be imported individually or via the barrel:
```tsx
import { Button, Card, StatusPill, LayerBadge } from "@/components/ui";
```

---

## 1. Button (`components/ui/button.tsx`)
Morpho-styled action button with primary brand blue, secondary, outline, ghost, danger, and link styles.

- **Import:** `@/components/ui/button` or `@/components/ui`
- **Props:**
  - `variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "link" | "default" | "destructive"` (default: `"primary"`)
  - `size?: "sm" | "md" | "lg" | "icon" | "icon-sm" | "icon-lg"` (default: `"md"`)
  - Standard `React.ButtonHTMLAttributes<HTMLButtonElement>`
- **Example:**
  ```tsx
  <Button variant="primary" size="md" onClick={handleSave}>
    Save Changes
  </Button>
  ```

---

## 2. Card (`components/ui/card.tsx`)
Morpho surface-2 container with subtle borders and structured slots.

- **Import:** `@/components/ui/card` or `@/components/ui`
- **Exports:** `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`
- **Example:**
  ```tsx
  <Card>
    <CardHeader>
      <CardTitle>Layer 1: Wallet Reserve</CardTitle>
      <CardDescription>Repay using USDC in your hot wallet</CardDescription>
    </CardHeader>
    <CardContent>
      <p>Content goes here</p>
    </CardContent>
  </Card>
  ```

---

## 3. Eyebrow (`components/ui/eyebrow.tsx`)
Monospace uppercase label for section headings, step headers, and meta badges.

- **Import:** `@/components/ui/eyebrow` or `@/components/ui`
- **Props:**
  - `dot?: boolean` (default: `false`)
  - `variant?: "default" | "brand" | "safe" | "warning" | "danger" | "neutral"` (default: `"default"`)
  - Standard `React.HTMLAttributes<HTMLSpanElement>`
- **Example:**
  ```tsx
  <Eyebrow dot variant="brand">Protection Layer</Eyebrow>
  ```

---

## 4. Badge (`components/ui/badge.tsx`)
General status and category pill badge.

- **Import:** `@/components/ui/badge` or `@/components/ui`
- **Props:**
  - `variant?: "default" | "secondary" | "brand" | "safe" | "watch" | "warning" | "critical" | "danger" | "outline"`
  - `size?: "sm" | "md"`
  - `dot?: boolean`
  - Standard `React.HTMLAttributes<HTMLSpanElement>`
- **Example:**
  ```tsx
  <Badge variant="brand" dot>Aave V3</Badge>
  ```

---

## 5. StatusPill (`components/ui/status-pill.tsx`)
Specialized Health Factor / Risk zone status pill with pulsing dot indicator.

- **Import:** `@/components/ui/status-pill` or `@/components/ui`
- **Props:**
  - `zone: "Safe" | "Watch" | "Warning" | "Critical"`
  - `dot?: boolean` (default: `true`)
  - `size?: "sm" | "md"` (default: `"sm"`)
- **Example:**
  ```tsx
  <StatusPill zone="Safe" />
  ```

---

## 6. Stat (`components/ui/stat.tsx`)
Morpho stat block for numerical figures with label, tabular numbers, and subtext.

- **Import:** `@/components/ui/stat` or `@/components/ui`
- **Props:**
  - `label: string`
  - `value: React.ReactNode`
  - `sub?: string`
  - `size?: "sm" | "md" | "lg"` (default: `"md"`)
- **Example:**
  ```tsx
  <Stat label="Health Factor" value="1.84" sub="Protected debt: $12,450" size="lg" />
  ```

---

## 7. DataTable (`components/ui/data-table.tsx`)
Dense Morpho data table (36px row height, subtle borders, monospace table headers).

- **Import:** `@/components/ui/data-table` or `@/components/ui`
- **Exports:** `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`
- **Example:**
  ```tsx
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Layer</TableHead>
        <TableHead>Asset</TableHead>
        <TableHead className="text-right">Capacity</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell>L1</TableCell>
        <TableCell>USDC</TableCell>
        <TableCell className="text-right font-mono">$500.00</TableCell>
      </TableRow>
    </TableBody>
  </Table>
  ```

---

## 8. Input (`components/ui/input.tsx`)
Text input with prefix/suffix icon slots and theme-aware focus states.

- **Import:** `@/components/ui/input` or `@/components/ui`
- **Props:**
  - `error?: boolean`
  - `prefixElement?: React.ReactNode`
  - `suffixElement?: React.ReactNode`
  - Standard `React.InputHTMLAttributes<HTMLInputElement>`
- **Example:**
  ```tsx
  <Input placeholder="Enter address or amount" error={false} />
  ```

---

## 9. NumberInput (`components/ui/number-input.tsx`)
Numeric input for token amounts with MAX button and currency suffix.

- **Import:** `@/components/ui/number-input` or `@/components/ui`
- **Props:**
  - `value: number | string`
  - `onChange: (val: number) => void`
  - `onValueChange?: (val: string) => void`
  - `token?: string` (e.g. `"USDC"`)
  - `onMax?: () => void`
  - `min?: number`, `max?: number`, `step?: number`
  - `error?: boolean`
- **Example:**
  ```tsx
  <NumberInput
    value={amount}
    onChange={setAmount}
    token="USDC"
    onMax={() => setAmount(balance)}
    min={0}
  />
  ```

---

## 10. Switch (`components/ui/switch.tsx`)
Accessible toggle switch styled with Morpho brand active color.

- **Import:** `@/components/ui/switch` or `@/components/ui`
- **Props:**
  - `checked?: boolean`
  - `onCheckedChange?: (checked: boolean) => void`
  - `size?: "sm" | "md"` (default: `"md"`)
  - `disabled?: boolean`
- **Example:**
  ```tsx
  <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
  ```

---

## 11. Tabs (`components/ui/tabs.tsx`)
Morpho segmented tabs for switching views or filters.

- **Import:** `@/components/ui/tabs` or `@/components/ui`
- **Exports:** `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`
- **Props:**
  - `Tabs`: `value: string`, `onValueChange: (val: string) => void`, `children: React.ReactNode`
  - `TabsTrigger`: `value: string`
  - `TabsContent`: `value: string`
- **Example:**
  ```tsx
  <Tabs value={activeTab} onValueChange={setActiveTab}>
    <TabsList>
      <TabsTrigger value="layers">Protection Layers</TabsTrigger>
      <TabsTrigger value="agents">AI Agents</TabsTrigger>
    </TabsList>
    <TabsContent value="layers">...</TabsContent>
    <TabsContent value="agents">...</TabsContent>
  </Tabs>
  ```

---

## 12. Tooltip (`components/ui/tooltip.tsx`)
Lightweight CSS hover tooltip for contextual info.

- **Import:** `@/components/ui/tooltip` or `@/components/ui`
- **Props:**
  - `content: React.ReactNode`
  - `side?: "top" | "bottom" | "left" | "right"` (default: `"top"`)
  - `children: React.ReactNode`
- **Example:**
  ```tsx
  <Tooltip content="Health Factor must stay above 1.0 to prevent liquidation">
    <span className="underline decoration-dotted cursor-help">Health Factor</span>
  </Tooltip>
  ```

---

## 13. Dialog (`components/ui/dialog.tsx`)
Accessible modal dialog with backdrop blur and escape key handling.

- **Import:** `@/components/ui/dialog` or `@/components/ui`
- **Exports:** `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`
- **Props:**
  - `Dialog`: `open?: boolean`, `defaultOpen?: boolean`, `onOpenChange?: (open: boolean) => void`
- **Example:**
  ```tsx
  <Dialog open={isOpen} onOpenChange={setIsOpen}>
    <DialogTrigger asChild>
      <Button>Open Wizard</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Setup Protection</DialogTitle>
        <DialogDescription>Configure your 3 layers of defense.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
        <Button variant="primary">Confirm</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  ```

---

## 14. Stepper (`components/ui/stepper.tsx`)
Multi-step progress indicator for the Protection Setup wizard.

- **Import:** `@/components/ui/stepper` or `@/components/ui`
- **Props:**
  - `steps: (string | { title: string; description?: string })[]`
  - `currentStep: number` (0-indexed)
  - `onStepClick?: (stepIndex: number) => void`
  - `orientation?: "horizontal" | "vertical"` (default: `"horizontal"`)
- **Example:**
  ```tsx
  <Stepper
    steps={["Position", "Thresholds", "Layer 1", "Layer 2", "Layer 3", "Review"]}
    currentStep={stepIndex}
    onStepClick={setStepIndex}
  />
  ```

---

## 15. HfGauge (`components/ui/hf-gauge.tsx`)
Health Factor gauge meter with color-coded risk zones and trigger/target markers.

- **Import:** `@/components/ui/hf-gauge` or `@/components/ui`
- **Props:**
  - `value: number` (current HF)
  - `min?: number` (default: 0.8)
  - `max?: number` (default: 3.0)
  - `trigger?: number`
  - `target?: number`
  - `showValue?: boolean` (default: true)
  - `size?: "sm" | "md" | "lg"` (default: `"md"`)
- **Example:**
  ```tsx
  <HfGauge value={1.42} trigger={1.25} target={1.80} />
  ```

---

## 16. ZoneBar (`components/ui/zone-bar.tsx`)
Continuous horizontal bar showing Critical, Warning, Watch, and Safe zones with cursor position.

- **Import:** `@/components/ui/zone-bar` or `@/components/ui`
- **Props:**
  - `hf: number`
  - `trigger?: number`
  - `target?: number`
  - `showLabels?: boolean` (default: true)
- **Example:**
  ```tsx
  <ZoneBar hf={1.65} trigger={1.25} target={1.80} />
  ```

---

## 17. LayerBadge (`components/ui/layer-badge.tsx`)
Pill badge with fixed colors for each protection layer:
- **L1**: Blue (`#2b76ff`) — Wallet Reserve
- **L2**: Purple (`#a855f7`) — Position Reserve
- **L3**: Amber (`#f97316`) — Flash Deleverage

- **Import:** `@/components/ui/layer-badge` or `@/components/ui`
- **Props:**
  - `layer: 1 | 2 | 3 | "L1" | "L2" | "L3"`
  - `showName?: boolean` (default: false)
  - `size?: "sm" | "md"` (default: `"sm"`)
- **Example:**
  ```tsx
  <LayerBadge layer={1} showName />
  ```

---

## 18. ApprovalExplainer (`components/ui/approval-explainer.tsx`)
Security explanation box detailing:
1. What this allows
2. What it cannot do
3. How to revoke

Reused on the landing page and protection wizard before wallet approval prompts.

- **Import:** `@/components/ui/approval-explainer` or `@/components/ui`
- **Props:**
  - `layer: 1 | 2 | 3`
  - `tokenSymbol: string`
  - `amountCap?: string`
  - `allows?: string[]` (optional override)
  - `cannotDo?: string[]` (optional override)
  - `howToRevoke?: string` (optional override)
- **Example:**
  ```tsx
  <ApprovalExplainer
    layer={1}
    tokenSymbol="USDC"
    amountCap="500 USDC"
  />
  ```

---

## 19. ThemeToggle (`components/ui/theme-toggle.tsx`)
Morpho-styled button to switch between dark and light themes without flash.

- **Import:** `@/components/ui/theme-toggle` or `@/components/ui`
- **Props:**
  - `showLabel?: boolean` (default: false)
  - Standard `React.ButtonHTMLAttributes<HTMLButtonElement>`
- **Example:**
  ```tsx
  <ThemeToggle />
  ```

---

## 20. BrandMark (`components/ui/brand-mark.tsx`)
Single source of truth for the Tahansoe logo mark. Adapts to theme tokens.

- **Import:** `@/components/ui/brand-mark` or `@/components/ui`
- **Props:**
  - `size?: number` (default: 28)
  - `ink?: string` (default: `"var(--text-primary)"`)
  - `accent?: string` (default: `"var(--brand)"`)
  - Standard `React.SVGAttributes<SVGSVGElement>`
- **Example:**
  ```tsx
  <BrandMark size={32} />
  ```
