import { IsoBox, IsoCoinStack, IsoCylinder, IsoFloor, IsoPhone, IsoRing, IsoSphere } from "../geo/primitives";
import { iso } from "../geo/iso";

export type MiniKind =
  | "trigger" | "pull" | "repay" | "done" | "redeem" | "flash" | "swap"
  | "connect" | "choose" | "approve" | "watch" | "alert";

function Check() {
  const [x, y] = iso(-8, -8, 14);
  return (
    <path
      d={`M${x + 14},${y - 22} l6,6 l12,-12`}
      fill="none"
      stroke="var(--safe)"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}

const ICONS: Record<MiniKind, React.ReactNode> = {
  trigger: (
    <>
      <IsoBox at={[-6, -6, 0]} size={[12, 12, 14]} m="danger" />
      <IsoBox at={[-6, -6, 14]} size={[12, 12, 32]} m="pearl" />
    </>
  ),
  pull: <IsoCoinStack at={[0, 0, 0]} count={4} r={14} />,
  repay: (
    <>
      <IsoBox at={[-18, -18, 0]} size={[36, 36, 22]} m="chrome" />
      <IsoBox at={[-18, -18, 22]} size={[36, 36, 10]} m="danger" opacity={0.65} />
    </>
  ),
  done: (
    <>
      <IsoSphere at={[0, 0, 18]} r={16} glass />
    </>
  ),
  redeem: (
    <>
      <IsoBox at={[-24, -10, 0]} size={[22, 22, 34]} m="glass" />
      <IsoCylinder at={[14, 14, 0]} r={11} h={5} />
      <IsoCylinder at={[14, 14, 6]} r={11} h={5} />
    </>
  ),
  flash: (
    <>
      <IsoRing at={[0, 0, 0]} r={28} width={2} dashed />
      <IsoCoinStack at={[0, 0, 0]} count={3} r={12} />
    </>
  ),
  swap: (
    <>
      <IsoBox at={[-26, -4, 0]} size={[20, 20, 26]} m="glass" />
      <IsoCoinStack at={[16, 8, 0]} count={3} r={10} />
    </>
  ),
  connect: (
    <>
      <IsoBox at={[-26, -6, 0]} size={[20, 20, 24]} m="pearl" />
      <IsoBox at={[10, 6, 0]} size={[20, 20, 32]} m="glass" />
    </>
  ),
  choose: (
    <>
      <IsoBox at={[-18, -18, 0]} size={[36, 36, 6]} m="chrome" />
      <IsoBox at={[-18, -18, 8]} size={[36, 36, 6]} m="glass" />
      <IsoBox at={[-18, -18, 16]} size={[36, 36, 6]} m="brand" />
    </>
  ),
  approve: (
    <>
      <IsoCoinStack at={[-8, -8, 0]} count={2} r={14} />
      <Check />
    </>
  ),
  watch: (
    <>
      <IsoRing at={[0, 0, 0]} r={28} width={1.5} dashed />
      <IsoSphere at={[0, 0, 20]} r={14} glass />
    </>
  ),
  alert: <IsoPhone at={[-2, -14, 0]} />,
};

/** Small isometric icon for step strips. */
export function MiniIcon({ kind, className }: { kind: MiniKind; className?: string }) {
  return (
    <svg viewBox="-48 -58 96 96" aria-hidden="true" shapeRendering="geometricPrecision" className={className ?? "size-14"}>
      <IsoFloor at={[0, 0, 0]} r={34} />
      {ICONS[kind]}
    </svg>
  );
}
