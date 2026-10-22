"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Environment,
  Float,
  Lightformer,
  ContactShadows,
  MeshTransmissionMaterial,
} from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

/** BrandMark outlines (270×270 viewBox), same paths as components/ui/brand-mark.tsx. */
const INK: [number, number][] = [
  [256, 64], [256, 128], [192.5, 128], [160, 95], [128, 64], [96, 95], [63.5, 128], [64, 128],
  [128, 192], [128, 256], [64.5, 256], [32, 223], [0, 192], [0, 64], [64, 0], [192, 0],
];
const BLOCK: [number, number][] = [
  [256, 192], [256, 256], [192.5, 256], [160, 223], [128, 192], [128, 128], [192, 128],
];

function useExtrude(points: [number, number][], depth: number) {
  return useMemo(() => {
    const s = new THREE.Shape();
    points.forEach(([x, y], i) => {
      const px = (x - 135) / 100;
      const py = -(y - 135) / 100;
      if (i === 0) s.moveTo(px, py);
      else s.lineTo(px, py);
    });
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.035,
      bevelSegments: 6,
      curveSegments: 1,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  }, [points, depth]);
}

function Glass() {
  return (
    <MeshTransmissionMaterial
      backside
      backsideThickness={0.3}
      samples={8}
      resolution={768}
      transmission={1}
      thickness={0.6}
      roughness={0.02}
      ior={1.35}
      chromaticAberration={1.2}
      anisotropicBlur={0.1}
      distortion={0.08}
      distortionScale={0.3}
      temporalDistortion={0.04}
      iridescence={1}
      iridescenceIOR={1.8}
      iridescenceThicknessRange={[0, 1400]}
      color="#a9d0ff"
      attenuationColor="#1d63ff"
      attenuationDistance={1.5}
      clearcoat={1}
      clearcoatRoughness={0}
      envMapIntensity={1.4}
    />
  );
}

function Chrome() {
  return <meshStandardMaterial color="#ffffff" metalness={1} roughness={0.06} envMapIntensity={1.3} />;
}

function Pearl() {
  return (
    <meshPhysicalMaterial
      color="#ffffff"
      roughness={0.25}
      clearcoat={1}
      iridescence={0.6}
      iridescenceThicknessRange={[200, 600]}
    />
  );
}

function Logo() {
  const ink = useExtrude(INK, 0.42);
  const block = useExtrude(BLOCK, 0.42);
  const base = useExtrude(INK, 0.1);
  const group = useRef<THREE.Group>(null);

  // Gentle cursor parallax.
  useFrame(({ pointer }, dt) => {
    if (!group.current) return;
    const k = 1 - Math.pow(0.001, dt);
    group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, 0.42 + pointer.x * 0.18, k);
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, -0.28 - pointer.y * 0.1, k);
  });

  return (
    <group ref={group} rotation={[-0.28, 0.42, 0.06]}>
      <mesh geometry={ink} castShadow>
        <Glass />
      </mesh>
      {/* Chrome "buffer" block: the offset piece of the mark */}
      <mesh geometry={block} position={[0.12, -0.12, 0.08]} castShadow>
        <Chrome />
      </mesh>
      {/* Thin chrome backplate gives the glass something bright to refract */}
      <mesh geometry={base} position={[0.08, -0.08, -0.42]}>
        <Chrome />
      </mesh>
    </group>
  );
}

/** Places the composition on the right on wide screens, top-centre on phones. */
function Composition() {
  const { viewport } = useThree();
  const wide = viewport.aspect > 1.1;
  const x = wide ? viewport.width * 0.22 : 0;
  const y = wide ? 0 : viewport.height * 0.22;
  const s = wide ? Math.min(1, viewport.height / 5.5) : Math.min(0.75, viewport.width / 4.4);

  return (
    <group position={[x, y, 0]} scale={s}>
      <Float speed={1.1} rotationIntensity={0.15} floatIntensity={0.35}>
        <Logo />
      </Float>
      <Float speed={1.6} floatIntensity={0.6}>
        <mesh position={[-1.75, -1.05, 0.7]}>
          <sphereGeometry args={[0.36, 64, 64]} />
          <Pearl />
        </mesh>
      </Float>
      <Float speed={2} floatIntensity={0.9}>
        <mesh position={[1.55, 1.35, 0.4]}>
          <sphereGeometry args={[0.16, 48, 48]} />
          <Pearl />
        </mesh>
      </Float>
      <ContactShadows position={[0, -1.9, 0]} opacity={0.28} scale={7} blur={3} far={3} color="#4b5bd6" />
    </group>
  );
}

export function HeroScene() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 0, 7], fov: 35 }}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      aria-hidden="true"
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 5, 4]} intensity={1.2} castShadow />
      <Composition />

      {/* Studio built from lightformers: bright white key + colored rims for the iridescent edges. */}
      <Environment resolution={512}>
        <color attach="background" args={["#f1f3fa"]} />
        <Lightformer form="rect" intensity={3} position={[0, 5, -2]} scale={[12, 3, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={2} position={[0, 0, 6]} scale={[10, 10, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={6} position={[-6, 1, 0]} rotation-y={Math.PI / 2} scale={[4, 8, 1]} color="#1f7bff" />
        <Lightformer form="rect" intensity={6} position={[6, 0, 0]} rotation-y={-Math.PI / 2} scale={[4, 8, 1]} color="#9b6bff" />
        <Lightformer form="ring" intensity={5} position={[2, -3, 3]} scale={3} color="#2ee6d6" />
        <Lightformer form="ring" intensity={4} position={[-3, 3, 2]} scale={2} color="#ff9ad5" />
        {/* Dark strips so chrome has contrast instead of reading as flat white */}
        <Lightformer form="rect" intensity={1} position={[4, 4, -4]} rotation-z={0.6} scale={[0.8, 10, 1]} color="#8a90b8" />
      </Environment>
    </Canvas>
  );
}
