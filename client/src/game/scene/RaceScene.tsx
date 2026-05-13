import { Billboard, Clone, Html, Sparkles, Text, useGLTF, useProgress } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Canvas, useFrame } from "@react-three/fiber";
import { BackSide, Box3, BufferAttribute, CanvasTexture, Group, MathUtils, PCFSoftShadowMap, PerspectiveCamera, PointLight, Points, Vector3 } from "three";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useState } from "react";
import type { MutableRefObject, ReactNode } from "react";
import { useGameStore } from "../store/useGameStore";
import type { TrackTheme } from "../types/messages";
import { DEFAULT_CAR_ID } from "../utils/carSelection";
import {
  getDistanceToFinishMeters,
  getPlayerProgressRatio,
  isPlayerOnFinalLap
} from "../utils/renderMotion";
import { getRenderedPlayersSnapshot, useRenderedPlayers } from "../utils/useRenderedPlayers";
import { GARAGE_CARS, getGarageCarById, type GarageCar } from "../utils/carCatalog";

const TRACK_Z_SCALE = 0.24;
const LANE_WIDTH = 2.8;
const RACE_START_TRANSITION_MS = 2600;
const RACE_CAR_GROUND_Y = 0;
const RACE_CAR_VISUAL_ROTATION_Y = 0;

interface EnvironmentConfig {
  background: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  ambient: string;
  ambientIntensity: number;
  directional: string;
  directionalIntensity: number;
  accent: string;
  trackSurface: string;
  trackPattern?: "checker";
  stadium?: boolean;
  lane: string;
  sideLane: string;
  lobbyMarker: string;
  lobbyBar: string;
  padRing: string;
  lantern: string;
  lanternEmissive: string;
  pillar: string;
  progressActive: string;
  progressPassed: string;
  progressIdle: string;
  progressFinish: string;
  sparkles: string;
  snow: boolean;
  pointLights: Array<{ position: [number, number, number]; color: string; intensity: number; distance: number }>;
}

const ENVIRONMENTS: Record<TrackTheme, EnvironmentConfig> = {
  "sunny-forest": {
    background: "#78c9ff",
    fog: "#d8f4ff",
    fogNear: 60,
    fogFar: 300,
    ambient: "#fff7dc",
    ambientIntensity: 0.72,
    directional: "#ffe29a",
    directionalIntensity: 2.15,
    accent: "#68b864",
    trackSurface: "#b8bec4",
    lane: "#f6f8f3",
    sideLane: "#8a936f",
    lobbyMarker: "#9bcf8e",
    lobbyBar: "#e6c36b",
    padRing: "#74b85f",
    lantern: "#74a94a",
    lanternEmissive: "#d8b456",
    pillar: "#5f7f4c",
    progressActive: "#74b85f",
    progressPassed: "#8fa56f",
    progressIdle: "#6b7b70",
    progressFinish: "#f0b75b",
    sparkles: "#ffffff",
    snow: false,
    pointLights: [
      { position: [-18, 12, -36], color: "#ffe29a", intensity: 2.2, distance: 120 },
      { position: [14, 8, 10], color: "#ffffff", intensity: 1.1, distance: 50 }
    ]
  },
  "snow-peak": {
    background: "#eaf8ff",
    fog: "#f6fbff",
    fogNear: 10,
    fogFar: 82,
    ambient: "#d7edff",
    ambientIntensity: 0.58,
    directional: "#d9efff",
    directionalIntensity: 0.85,
    accent: "#91bfe0",
    trackSurface: "#f3f7fa",
    lane: "#d7e8f2",
    sideLane: "#c5dbe9",
    lobbyMarker: "#dceff8",
    lobbyBar: "#c4dbe9",
    padRing: "#e8f7ff",
    lantern: "#c8e1f2",
    lanternEmissive: "#d8f0ff",
    pillar: "#dce9f2",
    progressActive: "#a8cde6",
    progressPassed: "#c2d9e8",
    progressIdle: "#e2edf4",
    progressFinish: "#9ec8df",
    sparkles: "#ffffff",
    snow: true,
    pointLights: [
      { position: [0, 10, -52], color: "#cbe7ff", intensity: 1.2, distance: 90 }
    ]
  },
  "fun-world": {
    background: "#44d8ff",
    fog: "#bdf7ff",
    fogNear: 80,
    fogFar: 360,
    ambient: "#fff0a6",
    ambientIntensity: 0.78,
    directional: "#fff176",
    directionalIntensity: 1.45,
    accent: "#ff4fb8",
    trackSurface: "#ff74c8",
    trackPattern: "checker",
    lane: "#ffe866",
    sideLane: "#7bf26d",
    lobbyMarker: "#ff8bd2",
    lobbyBar: "#ffe866",
    padRing: "#ffffff",
    lantern: "#ff6ac8",
    lanternEmissive: "#ffe866",
    pillar: "#6e49ff",
    progressActive: "#ffe866",
    progressPassed: "#ff8bd2",
    progressIdle: "#6e49ff",
    progressFinish: "#7bf26d",
    sparkles: "#fff176",
    snow: false,
    pointLights: [
      { position: [-12, 9, -42], color: "#ff4fb8", intensity: 1.8, distance: 90 },
      { position: [12, 8, -100], color: "#fff176", intensity: 1.5, distance: 80 }
    ]
  },
  "grand_prix": {
    background: "#c7d7e8",
    fog: "#dce8f4",
    fogNear: 120,
    fogFar: 420,
    ambient: "#e6eef8",
    ambientIntensity: 0.58,
    directional: "#ffffff",
    directionalIntensity: 1.1,
    accent: "#facc15",
    trackSurface: "#34373c",
    stadium: true,
    lane: "#f8fafc",
    sideLane: "#facc15",
    lobbyMarker: "#38bdf8",
    lobbyBar: "#facc15",
    padRing: "#38bdf8",
    lantern: "#f8fafc",
    lanternEmissive: "#ffffff",
    pillar: "#64748b",
    progressActive: "#facc15",
    progressPassed: "#38bdf8",
    progressIdle: "#475569",
    progressFinish: "#22c55e",
    sparkles: "#ffffff",
    snow: false,
    pointLights: [
      { position: [-16, 18, 8], color: "#ffffff", intensity: 6.5, distance: 95 },
      { position: [16, 18, 8], color: "#ffffff", intensity: 6.5, distance: 95 },
      { position: [-18, 20, -92], color: "#e0f2fe", intensity: 5.8, distance: 130 },
      { position: [18, 20, -92], color: "#e0f2fe", intensity: 5.8, distance: 130 }
    ]
  }
};

function laneToX(laneIndex: number) {
  const normalizedLane = Number.isFinite(laneIndex)
    ? Math.max(0, Math.min(3, Math.trunc(laneIndex)))
    : 0;
  return (normalizedLane - 1.5) * LANE_WIDTH;
}

function hashColor(playerId: string) {
  let hash = 0;
  for (let i = 0; i < playerId.length; i += 1) {
    hash = (hash << 5) - hash + playerId.charCodeAt(i);
    hash |= 0;
  }
  const palette = ["#28f6ff", "#ffc543", "#ff5468", "#64ff84", "#65a8ff"];
  const index = Math.abs(hash) % palette.length;
  return palette[index];
}

function getLobbySlotPosition(slotIndex: number, totalPlayers: number): [number, number, number] {
  const safeTotal = Math.max(1, totalPlayers);
  const positionsByCount: Record<number, Array<[number, number, number]>> = {
    1: [[0, RACE_CAR_GROUND_Y, 14.5]],
    2: [[-3.6, RACE_CAR_GROUND_Y, 14.6], [3.6, RACE_CAR_GROUND_Y, 14.6]],
    3: [[-4.2, RACE_CAR_GROUND_Y, 15.0], [0, RACE_CAR_GROUND_Y, 13.2], [4.2, RACE_CAR_GROUND_Y, 15.0]],
    4: [[-4.4, RACE_CAR_GROUND_Y, 15.1], [-1.4, RACE_CAR_GROUND_Y, 13.7], [1.4, RACE_CAR_GROUND_Y, 13.7], [4.4, RACE_CAR_GROUND_Y, 15.1]]
  };

  const positions = positionsByCount[Math.min(4, safeTotal)] ?? positionsByCount[4];
  return positions[Math.min(slotIndex, positions.length - 1)] ?? [0, RACE_CAR_GROUND_Y, 14.5];
}

function getStartTransitionProgress(racePhase: string, raceStartingAtMs: number, nowMs: number) {
  if (racePhase === "active" || racePhase === "finish") {
    return 1;
  }
  if (racePhase !== "starting" || raceStartingAtMs <= 0) {
    return 0;
  }
  return MathUtils.clamp(1 - ((raceStartingAtMs - nowMs) / RACE_START_TRANSITION_MS), 0, 1);
}

function getLobbyToTrackTransform(
  slotIndex: number,
  totalPlayers: number,
  laneIndex: number,
  racePhase: string,
  raceStartingAtMs: number,
  nowMs: number
) {
  const transitionProgress = getStartTransitionProgress(racePhase, raceStartingAtMs, nowMs);
  const easedProgress = MathUtils.smootherstep(transitionProgress, 0, 1);
  const [lobbyX, lobbyY, lobbyZ] = getLobbySlotPosition(slotIndex, totalPlayers);
  return {
    progress: transitionProgress,
    easedProgress,
    x: MathUtils.lerp(lobbyX, laneToX(laneIndex), easedProgress),
    y: MathUtils.lerp(lobbyY, RACE_CAR_GROUND_Y, easedProgress),
    z: MathUtils.lerp(lobbyZ, 0, easedProgress),
    lobbyX,
    lobbyY,
    lobbyZ
  };
}

const GARAGE_CAR_TARGET_LENGTH = 5;

function GarageCarModel({
  name,
  url,
  visualRotationY = RACE_CAR_VISUAL_ROTATION_Y
}: {
  name: string;
  url: string;
  visualRotationY?: number;
}) {
  const { scene } = useGLTF(url);
  const visualRef = useRef<Group>(null);
  const fit = useMemo(() => {
    const bounds = new Box3().setFromObject(scene);
    const size = new Vector3();
    const center = new Vector3();
    bounds.getSize(size);
    bounds.getCenter(center);

    const horizontalLength = Math.max(size.x, size.z);
    const scale = horizontalLength > 0 ? GARAGE_CAR_TARGET_LENGTH / horizontalLength : 1;

    return {
      scale,
      offset: [
        -center.x,
        -bounds.min.y,
        -center.z
      ] as [number, number, number]
    };
  }, [scene]);

  useEffect(() => {
    visualRef.current?.traverse((object) => {
      object.frustumCulled = false;
      const maybeMesh = object as {
        castShadow?: boolean;
        receiveShadow?: boolean;
        isMesh?: boolean;
      };
      if (maybeMesh.isMesh) {
        maybeMesh.castShadow = true;
        maybeMesh.receiveShadow = true;
      }
    });
  }, [scene]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.debug(`[car-visual-offset] ${name}: visualRotationY=${visualRotationY}`);
    }
  }, [name, visualRotationY]);

  return (
    <group name="pivotGroup" scale={fit.scale}>
      <group ref={visualRef} rotation={[0, visualRotationY, 0]}>
        <group position={fit.offset}>
          <Clone object={scene} castShadow receiveShadow frustumCulled={false} />
        </group>
      </group>
    </group>
  );
}

useGLTF.preload(GARAGE_CARS[0].url);

const GARAGE_TURNTABLE_CAR_Y = 0.36;
const GARAGE_TURNTABLE_POSITION = [0, GARAGE_TURNTABLE_CAR_Y, 0] as [number, number, number];
const GARAGE_CAROUSEL_POSITIONS: Record<-1 | 0 | 1, [number, number, number]> = {
  "-1": [-6.3, 0.08, -2.65],
  0: GARAGE_TURNTABLE_POSITION,
  1: [6.3, 0.08, -2.65]
};

function wrapGarageIndex(index: number) {
  const total = GARAGE_CARS.length;
  return ((index % total) + total) % total;
}

function SelectableGarageCar({
  car,
  index,
  slot,
  turntableRotationRef,
  onSelect
}: {
  car: GarageCar;
  index: number;
  slot: -1 | 0 | 1;
  turntableRotationRef: MutableRefObject<number>;
  onSelect: (index: number) => void;
}) {
  const groupRef = useRef<Group>(null);
  const isSelected = slot === 0;
  const targetPosition = GARAGE_CAROUSEL_POSITIONS[slot];
  const targetScale = isSelected ? 1 : 0.86;

  useFrame((_, delta) => {
    if (!groupRef.current) {
      return;
    }
    const targetRotation = isSelected ? Math.PI + turntableRotationRef.current : car.bayRotation;
    const factor = 1 - Math.exp(-7.2 * delta);
    groupRef.current.position.x = MathUtils.lerp(groupRef.current.position.x, targetPosition[0], factor);
    groupRef.current.position.y = MathUtils.lerp(groupRef.current.position.y, targetPosition[1], factor);
    groupRef.current.position.z = MathUtils.lerp(groupRef.current.position.z, targetPosition[2], factor);
    groupRef.current.rotation.y = MathUtils.lerp(groupRef.current.rotation.y, targetRotation, factor);
    groupRef.current.scale.setScalar(MathUtils.lerp(groupRef.current.scale.x, targetScale, factor));
  });

  return (
    <group
      ref={groupRef}
      visible
      position={targetPosition}
      rotation={[0, car.bayRotation, 0]}
      scale={targetScale}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(index);
      }}
      onPointerDown={(event) => {
        onSelect(index);
        if (!isSelected) {
          event.stopPropagation();
        }
      }}
    >
      <Suspense fallback={null}>
        <GarageCarModel name={car.name} url={car.url} visualRotationY={car.visualRotationY} />
      </Suspense>
      <mesh position={[0, 0.82, 0.55]} scale={[1.45, 0.08, 0.16]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={car.accentColor} emissive={car.accentColor} emissiveIntensity={isSelected ? 0.24 : 0.12} roughness={0.42} />
      </mesh>
    </group>
  );
}

function InteractiveTurntable() {
  const turntableRef = useRef<Group>(null);
  const selectedCarId = useGameStore((state) => state.selectedCarId);
  const selectCar = useGameStore((state) => state.selectCar);
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const initialIndex = GARAGE_CARS.findIndex((car) => car.id === selectedCarId);
    return initialIndex >= 0 ? initialIndex : 0;
  });
  const rotationRef = useRef(0);
  const velocityRef = useRef(0.22);
  const draggingRef = useRef(false);
  const lastPointerXRef = useRef(0);
  const keyDirectionRef = useRef(0);
  const visibleCars = useMemo(
    () =>
      ([-1, 0, 1] as const).map((slot) => {
        const index = wrapGarageIndex(selectedIndex + slot);
        return { slot, index, car: GARAGE_CARS[index] };
      }),
    [selectedIndex]
  );
  const selectedCar = GARAGE_CARS[selectedIndex] ?? GARAGE_CARS[0];

  const selectGarageIndex = (nextIndex: number) => {
    const wrappedIndex = wrapGarageIndex(nextIndex);
    const nextCar = GARAGE_CARS[wrappedIndex];
    if (!nextCar) {
      return;
    }
    setSelectedIndex(wrappedIndex);
    selectCar(nextCar.id);
  };

  useEffect(() => {
    const nextSelectedIndex = GARAGE_CARS.findIndex((car) => car.id === selectedCarId);
    if (nextSelectedIndex >= 0) {
      setSelectedIndex(nextSelectedIndex);
    }
  }, [selectedCarId]);

  useEffect(() => {
    for (const { car } of visibleCars) {
      useGLTF.preload(car.url);
    }
  }, [visibleCars]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) {
        return;
      }
      const deltaX = event.clientX - lastPointerXRef.current;
      lastPointerXRef.current = event.clientX;
      velocityRef.current = deltaX * 0.012;
      rotationRef.current += velocityRef.current;
    };
    const stopDrag = () => {
      draggingRef.current = false;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "a" || event.key === "A" || event.key === "ArrowLeft") {
        keyDirectionRef.current = 1;
      }
      if (event.key === "d" || event.key === "D" || event.key === "ArrowRight") {
        keyDirectionRef.current = -1;
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (
        event.key === "a"
        || event.key === "A"
        || event.key === "ArrowLeft"
        || event.key === "d"
        || event.key === "D"
        || event.key === "ArrowRight"
      ) {
        keyDirectionRef.current = 0;
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useFrame((_, delta) => {
    if (!turntableRef.current) {
      return;
    }
    if (keyDirectionRef.current !== 0) {
      velocityRef.current += keyDirectionRef.current * delta * 2.8;
    }
    rotationRef.current += velocityRef.current * delta;
    velocityRef.current *= Math.exp(-delta * (draggingRef.current ? 1.5 : 2.8));
    turntableRef.current.rotation.y = rotationRef.current;
  });

  return (
    <group
      onPointerDown={(event) => {
        event.stopPropagation();
        draggingRef.current = true;
        lastPointerXRef.current = event.nativeEvent.clientX;
      }}
    >
      <group ref={turntableRef}>
        <mesh receiveShadow position={[0, 0.08, 0]}>
          <cylinderGeometry args={[4.6, 4.6, 0.2, 112]} />
          <meshStandardMaterial color="#202225" emissive={selectedCar.accentColor} emissiveIntensity={0.04} roughness={0.28} metalness={0.86} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.27, 0]}>
          <ringGeometry args={[4.38, 4.62, 128]} />
          <meshBasicMaterial color={selectedCar.accentColor} transparent opacity={0.72} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.29, 0]}>
          <ringGeometry args={[1.1, 1.16, 96]} />
          <meshBasicMaterial color="#8c4dff" transparent opacity={0.42} />
        </mesh>
      </group>
      {visibleCars.map(({ car, index, slot }) => (
        <SelectableGarageCar
          key={car.id}
          car={car}
          index={index}
          slot={slot}
          turntableRotationRef={rotationRef}
          onSelect={selectGarageIndex}
        />
      ))}
      <pointLight position={[0, 0.65, 0.1]} color="#32a9ff" intensity={3.2} distance={7} />
    </group>
  );
}

function GarageLoadingOverlay() {
  const { progress } = useProgress();
  const roundedProgress = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <Html center>
      <div
        style={{
          minWidth: 190,
          padding: "12px 16px",
          border: "1px solid rgba(255, 255, 255, 0.16)",
          borderRadius: 12,
          background: "rgba(5, 10, 18, 0.68)",
          color: "#dbeafe",
          fontFamily: "Inter, Roboto, system-ui, sans-serif",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.6,
          textAlign: "center",
          backdropFilter: "blur(12px)",
          boxShadow: "0 16px 44px rgba(0, 0, 0, 0.34)"
        }}
      >
        Loading Garage: {roundedProgress}%
      </div>
    </Html>
  );
}

function RaceLoadingOverlay() {
  const { active, progress } = useProgress();
  const [visible, setVisible] = useState(true);
  const displayProgress = !active && progress <= 0 ? 100 : progress;
  const roundedProgress = Math.max(0, Math.min(100, Math.round(displayProgress)));

  useEffect(() => {
    if (!active && roundedProgress >= 100) {
      const hideTimer = window.setTimeout(() => setVisible(false), 280);
      return () => window.clearTimeout(hideTimer);
    }
    setVisible(true);
    return undefined;
  }, [active, roundedProgress]);

  if (!visible) {
    return null;
  }

  return (
    <Html fullscreen zIndexRange={[100, 0]}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          pointerEvents: "none",
          background: "linear-gradient(180deg, rgba(3, 7, 18, 0.34), rgba(3, 7, 18, 0.52))"
        }}
      >
        <div
          style={{
            width: 260,
            padding: "18px 20px",
            border: "1px solid rgba(255, 255, 255, 0.18)",
            borderRadius: 14,
            background: "rgba(7, 12, 22, 0.72)",
            color: "#f8fbff",
            fontFamily: "Inter, Roboto, system-ui, sans-serif",
            boxShadow: "0 18px 54px rgba(0, 0, 0, 0.38)",
            backdropFilter: "blur(14px)"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800, letterSpacing: 0.5 }}>
            <span>Loading Race</span>
            <span>{roundedProgress}%</span>
          </div>
          <div style={{ marginTop: 12, height: 7, borderRadius: 999, overflow: "hidden", background: "rgba(255, 255, 255, 0.14)" }}>
            <div
              style={{
                width: `${roundedProgress}%`,
                height: "100%",
                borderRadius: 999,
                background: "linear-gradient(90deg, #22d3ee, #a7f3d0)",
                transition: "width 180ms ease"
              }}
            />
          </div>
        </div>
      </div>
    </Html>
  );
}

function ShowroomCameraRig() {
  useFrame(({ camera, clock }) => {
    const pan = Math.sin(clock.elapsedTime * 0.2) * 0.34;
    camera.position.x = MathUtils.damp(camera.position.x, 2.2 + pan, 2.6, 0.016);
    camera.position.y = MathUtils.damp(camera.position.y, 2.25, 2.6, 0.016);
    camera.position.z = MathUtils.damp(camera.position.z, 9.2, 2.6, 0.016);
    camera.lookAt(0.75 + pan * 0.1, 1.05, -0.15);
  });

  return null;
}

function TireStack({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {[0, 0.42, 0.84, 1.26].map((y) => (
        <mesh key={`tire-${y}`} rotation-x={Math.PI / 2} position={[0, y, 0]} castShadow receiveShadow>
          <torusGeometry args={[0.62, 0.18, 12, 32]} />
          <meshLambertMaterial color="#050505" />
        </mesh>
      ))}
    </group>
  );
}

function ToolChest({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow receiveShadow position={[0, 0.9, 0]}>
        <boxGeometry args={[2.0, 1.8, 0.78]} />
        <meshLambertMaterial color="#7b1420" />
      </mesh>
      {[0.35, 0.75, 1.15].map((y) => (
        <mesh key={`drawer-${y}`} position={[0, y, 0.42]}>
          <boxGeometry args={[1.72, 0.07, 0.05]} />
          <meshLambertMaterial color="#d6dde6" />
        </mesh>
      ))}
      {[-0.68, 0.68].map((x) => (
        <mesh key={`wheel-${x}`} position={[x, 0.02, 0.25]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.13, 0.13, 0.12, 16]} />
          <meshLambertMaterial color="#050505" />
        </mesh>
      ))}
    </group>
  );
}

function CardboardBoxes() {
  return (
    <group position={[10.8, 0, -10.8]}>
      {[
        [0, 0.38, 0, 1.45, 0.76, 1.2],
        [1.25, 0.32, 0.22, 1.0, 0.64, 0.92],
        [-0.55, 1.0, -0.35, 0.9, 0.72, 0.84]
      ].map(([x, y, z, sx, sy, sz], index) => (
        <mesh key={`box-${index}`} position={[x, y, z]} castShadow receiveShadow>
          <boxGeometry args={[sx, sy, sz]} />
          <meshLambertMaterial color="#9a6b3d" />
        </mesh>
      ))}
    </group>
  );
}

function CarLift() {
  return (
    <group position={[-12.5, 0, -8.5]}>
      {[-1.2, 1.2].map((x) => (
        <mesh key={`lift-post-${x}`} position={[x, 2.4, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.32, 4.8, 0.32]} />
          <meshLambertMaterial color="#2b3138" />
        </mesh>
      ))}
      <mesh position={[0, 1.7, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 0.18, 1.25]} />
        <meshLambertMaterial color="#d69f2f" />
      </mesh>
      <mesh position={[0, 3.9, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.4, 0.2, 0.34]} />
        <meshLambertMaterial color="#303842" />
      </mesh>
    </group>
  );
}

function WrenchSign() {
  return (
    <group position={[0, 5.8, -17.86]}>
      <mesh>
        <boxGeometry args={[4.3, 0.16, 0.12]} />
        <meshStandardMaterial color="#9d5cff" emissive="#9d5cff" emissiveIntensity={1.45} toneMapped={false} />
      </mesh>
      <mesh rotation-z={0.76}>
        <boxGeometry args={[2.35, 0.16, 0.12]} />
        <meshStandardMaterial color="#56c8ff" emissive="#56c8ff" emissiveIntensity={1.45} toneMapped={false} />
      </mesh>
      <mesh position={[-1.34, 0.76, 0]}>
        <torusGeometry args={[0.42, 0.07, 10, 24]} />
        <meshStandardMaterial color="#56c8ff" emissive="#56c8ff" emissiveIntensity={1.55} toneMapped={false} />
      </mesh>
      <pointLight color="#9d5cff" intensity={1.6} distance={10} position={[0, 0, 1.5]} />
    </group>
  );
}

function GarageProps() {
  return (
    <group>
      <CarLift />
      <ToolChest position={[12.4, 0, -7.4]} />
      <TireStack position={[-10.4, 0.15, -1.4]} />
      <TireStack position={[13.2, 0.15, -12.2]} />
      <CardboardBoxes />
      <WrenchSign />
      {[-9, -3, 3, 9].map((x, index) => (
        <mesh key={`wall-neon-blue-${x}`} position={[x, 4.2 + (index % 2) * 0.75, -17.92]}>
          <boxGeometry args={[3.4, 0.08, 0.08]} />
          <meshStandardMaterial
            color={index % 2 === 0 ? "#56c8ff" : "#9d5cff"}
            emissive={index % 2 === 0 ? "#56c8ff" : "#9d5cff"}
            emissiveIntensity={1.35}
            toneMapped={false}
          />
        </mesh>
      ))}
      {[-18.4, 18.4].map((x) => (
        <mesh key={`side-neon-${x}`} position={[x, 4.4, -5]} rotation-y={x < 0 ? Math.PI / 2 : -Math.PI / 2}>
          <boxGeometry args={[11, 0.08, 0.08]} />
          <meshStandardMaterial
            color={x < 0 ? "#9d5cff" : "#56c8ff"}
            emissive={x < 0 ? "#9d5cff" : "#56c8ff"}
            emissiveIntensity={1.25}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function ShowroomSceneContent() {
  return (
    <>
      <color attach="background" args={["#050505"]} />
      <ambientLight color="#ffffff" intensity={0.5} />
      <hemisphereLight args={["#f2f6ff", "#1a1a1a", 1.35]} />
      <directionalLight position={[0, 5, -10]} color="#d5e5ff" intensity={2.1} />

      <spotLight
        position={[0, 8.8, 1.3]}
        target-position={[0, 0.9, 0.1]}
        angle={0.42}
        penumbra={0.9}
        intensity={170}
        color="#f8fbff"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={5}
        shadow-camera-far={13}
        shadow-camera-fov={36}
        shadow-bias={-0.00008}
        shadow-normalBias={0.02}
      />
      <spotLight position={[-6.2, 7.4, -1.3]} target-position={[-6.2, 0.78, -2.8]} angle={0.58} penumbra={0.88} intensity={105} color="#d9e8ff" />
      <spotLight position={[6.2, 7.4, -1.3]} target-position={[6.2, 0.78, -2.8]} angle={0.58} penumbra={0.88} intensity={105} color="#ffe6c4" />
      <pointLight position={[0, 0.6, 0.15]} color="#1f9dff" intensity={3.4} distance={7.5} />
      <pointLight position={[-8.5, 3.3, -12]} color="#9d5cff" intensity={1.1} distance={13} />
      <pointLight position={[8.5, 3.3, -12]} color="#56c8ff" intensity={1.1} distance={13} />
      {[-9, -3, 3, 9].map((x) => (
        <pointLight key={`ceiling-fill-${x}`} position={[x, 7.8, -4.5]} color="#dbeafe" intensity={1.4} distance={15} />
      ))}

      <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, -0.04, -4]}>
        <planeGeometry args={[58, 48]} />
        <meshStandardMaterial color="#151515" roughness={0.36} metalness={0.42} />
      </mesh>
      <mesh receiveShadow position={[0, 6, -18]}>
        <planeGeometry args={[44, 12]} />
        <meshLambertMaterial color="#1e2025" />
      </mesh>
      {Array.from({ length: 11 }, (_, index) => -20 + index * 4).map((x) => (
        <mesh key={`back-wall-panel-${x}`} position={[x, 6, -17.96]}>
          <boxGeometry args={[0.05, 11.4, 0.08]} />
          <meshLambertMaterial color="#3a3b3e" />
        </mesh>
      ))}
      <mesh receiveShadow position={[-18.5, 6, -4]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[28, 12]} />
        <meshLambertMaterial color="#1a1c21" />
      </mesh>
      <mesh receiveShadow position={[18.5, 6, -4]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[28, 12]} />
        <meshLambertMaterial color="#1a1c21" />
      </mesh>

      {[-12, -4, 4, 12].map((x) => (
        <mesh key={`garage-ceiling-strip-${x}`} position={[x, 8.8, -5]} rotation-x={Math.PI / 2}>
          <planeGeometry args={[0.36, 22]} />
          <meshBasicMaterial color="#dbeafe" transparent opacity={0.26} />
        </mesh>
      ))}
      <GarageProps />

      <Suspense fallback={<GarageLoadingOverlay />}>
        <InteractiveTurntable />
      </Suspense>
      <ShowroomCameraRig />
    </>
  );
}

export function MenuScene() {
  return (
    <div className="absolute inset-0">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [2.2, 2.25, 9.2], fov: 48, near: 0.1, far: 1000 }}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          gl.setClearColor("#050505");
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = PCFSoftShadowMap;
        }}
      >
        <ShowroomSceneContent />
      </Canvas>
    </div>
  );
}

function CarEntity({ playerId, slotIndex, totalPlayers }: { playerId: string; slotIndex: number; totalPlayers: number }) {
  const groupRef = useRef<Group>(null);
  const glowRef = useRef<PointLight>(null);
  const localPlayerId = useGameStore((state) => state.playerId);
  const displayName = useGameStore((state) => state.players[playerId]?.displayName ?? "Driver");
  const carId = useGameStore((state) => state.players[playerId]?.carId ?? DEFAULT_CAR_ID);
  const car = useMemo(() => getGarageCarById(carId), [carId]);
  const color = useMemo(() => hashColor(playerId), [playerId]);
  const labelText = playerId === localPlayerId ? "You" : displayName;
  const labelPanelWidth = useMemo(
    () => Math.max(1.15, Math.min(3, (labelText.length * 0.18) + 0.45)),
    [labelText]
  );

  useFrame((_, delta) => {
    const state = useGameStore.getState();
    const player = state.players[playerId];
    if (!player || !groupRef.current) {
      return;
    }

    const renderedState = getRenderedPlayersSnapshot();
    const renderedPlayer = renderedState.players[playerId];
    const nowMs = Date.now();
    const playerRacePhase = renderedPlayer?.racePhase ?? player.racePhase ?? state.racePhase;

    let targetX = 0;
    let targetY = RACE_CAR_GROUND_Y;
    let targetZ = 0;
    let targetPitch = 0;
    let targetYaw = 0;
    let targetScaleZ = 1;
    let lightIntensity = 0.22;

    if (playerRacePhase === "lobby" || playerRacePhase === "starting") {
      const transform = getLobbyToTrackTransform(
        slotIndex,
        totalPlayers,
        player.laneIndex,
        playerRacePhase,
        state.raceStartingAtMs,
        nowMs
      );
      const lobbyYaw = transform.lobbyX > 0 ? -0.28 : transform.lobbyX < 0 ? 0.28 : 0;
      targetX = transform.x;
      targetY = transform.y;
      targetZ = transform.z;
      targetYaw = MathUtils.lerp(lobbyYaw, 0, transform.easedProgress);
      targetPitch = MathUtils.lerp(0.02, 0, transform.easedProgress);
      lightIntensity = 0.16 + (transform.progress * 0.08);
    } else if (renderedPlayer) {
      targetX = laneToX(renderedPlayer.laneIndex);
      targetY = RACE_CAR_GROUND_Y;
      targetZ = -renderedPlayer.positionMeters * TRACK_Z_SCALE;
      targetPitch = Math.min(0.04, renderedPlayer.speedMps / 3000);
      targetScaleZ = 1 + Math.min(0.45, renderedPlayer.speedMps / 200);
      lightIntensity = 0.24;
    }

    groupRef.current.position.set(
      MathUtils.damp(groupRef.current.position.x, targetX, 7.5, delta),
      MathUtils.damp(groupRef.current.position.y, targetY, 7.5, delta),
      MathUtils.damp(groupRef.current.position.z, targetZ, 7.5, delta)
    );
    groupRef.current.rotation.x = MathUtils.damp(groupRef.current.rotation.x, targetPitch, 7.5, delta);
    groupRef.current.rotation.y = MathUtils.damp(groupRef.current.rotation.y, targetYaw, 7.5, delta);
    groupRef.current.scale.z = MathUtils.damp(groupRef.current.scale.z, targetScaleZ, 7.5, delta);

    if (glowRef.current) {
      glowRef.current.intensity = MathUtils.damp(glowRef.current.intensity, lightIntensity, 5.5, delta);
    }
  });

  return (
    <group ref={groupRef}>
      <GarageCarModel name={car.name} url={car.url} visualRotationY={car.visualRotationY} />
      <Billboard position={[0, 2.05, 0]} follow>
        <group renderOrder={12}>
          <mesh position={[0, 0, -0.02]}>
            <planeGeometry args={[labelPanelWidth, 0.38]} />
            <meshBasicMaterial color="#04101f" transparent opacity={0.68} depthWrite={false} />
          </mesh>
          <Text
            fontSize={0.2}
            color="#f8fbff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.03}
            outlineColor="#02101c"
            maxWidth={2.6}
          >
            {labelText}
          </Text>
        </group>
      </Billboard>
      <pointLight ref={glowRef} color={color} intensity={0.22} distance={4.5} position={[0, 0.95, 0]} />
    </group>
  );
}

function CarsLayer() {
  const playerIds = useGameStore((state) => state.playerIds);
  const localPlayerId = useGameStore((state) => state.playerId);
  const [deferredCarsReady, setDeferredCarsReady] = useState(false);
  const playerIdSignature = playerIds.join("|");

  useEffect(() => {
    setDeferredCarsReady(false);
    const preloadTimer = window.setTimeout(() => setDeferredCarsReady(true), 650);
    return () => window.clearTimeout(preloadTimer);
  }, [localPlayerId, playerIdSignature]);

  const visiblePlayerIds = deferredCarsReady
    ? playerIds
    : playerIds.filter((playerId) => playerId === localPlayerId);

  return (
    <group>
      {visiblePlayerIds.map((playerId) => (
        <CarEntity
          key={playerId}
          playerId={playerId}
          slotIndex={Math.max(0, playerIds.indexOf(playerId))}
          totalPlayers={playerIds.length}
        />
      ))}
    </group>
  );
}

function disposeObjectTree(root: Group | null) {
  if (!root) {
    return;
  }
  root.traverse((object) => {
    const disposable = object as {
      geometry?: { dispose?: () => void };
      material?: { dispose?: () => void; map?: { dispose?: () => void } } | Array<{ dispose?: () => void; map?: { dispose?: () => void } }>;
    };
    disposable.geometry?.dispose?.();
    const materials = Array.isArray(disposable.material)
      ? disposable.material
      : disposable.material
        ? [disposable.material]
        : [];
    for (const material of materials) {
      material.map?.dispose?.();
      material.dispose?.();
    }
  });
}

function ManagedEnvironmentAssets({ children }: { children: ReactNode }) {
  const groupRef = useRef<Group>(null);

  useEffect(() => {
    const ownedGroup = groupRef.current;
    return () => {
      disposeObjectTree(ownedGroup);
    };
  }, []);

  return <group ref={groupRef}>{children}</group>;
}

function SunnyForestProps() {
  const trees = useMemo(
    () => Array.from({ length: 56 }, (_, index) => {
      const side = index % 2 === 0 ? -1 : 1;
      const row = Math.floor(index / 2);
      const offset = ((row % 3) - 1) * 2.2;
      return {
        key: `tree-${index}`,
        x: side * (12.5 + (row % 4) * 1.2),
        z: 22 - row * 34 + offset,
        scale: 0.85 + (index % 5) * 0.12
      };
    }),
    []
  );

  return (
    <group>
      <mesh position={[22, 38, -70]}>
        <sphereGeometry args={[7.2, 32, 16]} />
        <meshBasicMaterial color="#ffe184" />
      </mesh>
      {[-18, -7, 8, 23].map((x, index) => (
        <group key={`cloud-${index}`} position={[x, 28 + (index % 2) * 2, -42 - index * 34]}>
          <mesh>
            <sphereGeometry args={[2.7, 18, 12]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.78} />
          </mesh>
          <mesh position={[2.4, 0.2, 0.4]}>
            <sphereGeometry args={[2.1, 18, 12]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.7} />
          </mesh>
          <mesh position={[-2.2, -0.1, -0.2]}>
            <sphereGeometry args={[1.9, 18, 12]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.68} />
          </mesh>
        </group>
      ))}
      {trees.map((tree) => (
        <group key={tree.key} position={[tree.x, 0, tree.z]} scale={tree.scale}>
          <mesh position={[0, 1.1, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.28, 0.36, 2.2, 8]} />
            <meshStandardMaterial color="#7c5635" roughness={0.9} />
          </mesh>
          <mesh position={[0, 3.0, 0]} castShadow receiveShadow>
            <coneGeometry args={[1.25, 2.6, 9]} />
            <meshStandardMaterial color="#2f8f3a" roughness={0.82} />
          </mesh>
          <mesh position={[0, 4.25, 0]} castShadow receiveShadow>
            <coneGeometry args={[0.92, 2.0, 9]} />
            <meshStandardMaterial color="#3dae4f" roughness={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Snowfall() {
  const pointsRef = useRef<Points>(null);
  const positions = useMemo(() => {
    const values = new Float32Array(540);
    for (let index = 0; index < values.length; index += 3) {
      values[index] = (Math.random() - 0.5) * 46;
      values[index + 1] = 3 + Math.random() * 22;
      values[index + 2] = 25 - Math.random() * 170;
    }
    return values;
  }, []);

  useFrame((_, delta) => {
    if (!pointsRef.current) {
      return;
    }
    const attribute = pointsRef.current.geometry.getAttribute("position") as BufferAttribute;
    for (let index = 0; index < attribute.count; index += 1) {
      const y = attribute.getY(index) - delta * (2.2 + (index % 5) * 0.24);
      const x = attribute.getX(index) + Math.sin(Date.now() / 900 + index) * delta * 0.18;
      attribute.setX(index, x);
      attribute.setY(index, y < 0.4 ? 25 : y);
    }
    attribute.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#ffffff" size={0.12} transparent opacity={0.72} depthWrite={false} />
    </points>
  );
}

function FunWorldProps() {
  const smileyTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#ffe85f";
      context.beginPath();
      context.arc(64, 64, 58, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#25211f";
      context.beginPath();
      context.arc(43, 50, 8, 0, Math.PI * 2);
      context.arc(85, 50, 8, 0, Math.PI * 2);
      context.fill();
      context.lineWidth = 8;
      context.strokeStyle = "#25211f";
      context.beginPath();
      context.arc(64, 68, 30, 0.15 * Math.PI, 0.85 * Math.PI);
      context.stroke();
    }
    return new CanvasTexture(canvas);
  }, []);

  useEffect(() => {
    return () => {
      smileyTexture.dispose();
    };
  }, [smileyTexture]);

  const props = useMemo(
    () => Array.from({ length: 18 }, (_, index) => ({
      key: `fun-${index}`,
      x: (index % 2 === 0 ? -1 : 1) * (11 + (index % 3) * 1.8),
      z: 16 - Math.floor(index / 2) * 42,
      color: ["#ff5cb8", "#fff176", "#67f06d", "#7f6bff"][index % 4],
      phase: index * 0.7
    })),
    []
  );

  return (
    <group>
      {props.map(({ key, ...prop }, index) => (
        <BouncyFunProp key={key} {...prop} smileyTexture={smileyTexture} useSmiley={index % 3 === 0} />
      ))}
    </group>
  );
}

function BouncyFunProp({
  x,
  z,
  color,
  phase,
  smileyTexture,
  useSmiley
}: {
  x: number;
  z: number;
  color: string;
  phase: number;
  smileyTexture: CanvasTexture;
  useSmiley: boolean;
}) {
  const groupRef = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) {
      return;
    }
    groupRef.current.position.y = 2.6 + Math.sin(clock.elapsedTime * 1.8 + phase) * 0.45;
    groupRef.current.rotation.y += 0.012;
  });

  return (
    <group ref={groupRef} position={[x, 2.6, z]}>
      {useSmiley ? (
        <mesh castShadow>
          <sphereGeometry args={[1.35, 32, 16]} />
          <meshStandardMaterial color="#ffe85f" map={smileyTexture} roughness={0.45} />
        </mesh>
      ) : (
        <mesh castShadow>
          <dodecahedronGeometry args={[1.25, 0]} />
          <meshStandardMaterial color={color} roughness={0.42} metalness={0.05} />
        </mesh>
      )}
    </group>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) {
    return [1, 1, 1];
  }
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255
  ];
}

function StadiumCrowd() {
  const pointsRef = useRef<Points>(null);
  const phasesRef = useRef<Float32Array | null>(null);
  const baseYRef = useRef<Float32Array | null>(null);
  const crowd = useMemo(() => {
    const count = 780;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const baseY = new Float32Array(count);
    const palette = ["#f8fafc", "#facc15", "#38bdf8", "#fb7185", "#86efac", "#c084fc"];

    for (let index = 0; index < count; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const row = Math.floor(index / 52) % 6;
      const z = 22 - (Math.floor(index / 12) * 4.2) - Math.random() * 3.4;
      const x = side * (13.2 + row * 1.35 + Math.random() * 0.72);
      const y = 2.55 + row * 0.58 + Math.random() * 0.42;
      const color = hexToRgb(palette[index % palette.length]);

      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
      colors[index * 3] = color[0];
      colors[index * 3 + 1] = color[1];
      colors[index * 3 + 2] = color[2];
      phases[index] = Math.random() * Math.PI * 2;
      baseY[index] = y;
    }

    return { positions, colors, phases, baseY };
  }, []);

  useEffect(() => {
    phasesRef.current = crowd.phases;
    baseYRef.current = crowd.baseY;
  }, [crowd]);

  useFrame(({ clock }) => {
    const points = pointsRef.current;
    const phases = phasesRef.current;
    const baseY = baseYRef.current;
    const positionAttribute = points?.geometry.getAttribute("position") as BufferAttribute | undefined;
    if (!points || !phases || !baseY || !positionAttribute) {
      return;
    }
    const time = clock.elapsedTime;
    for (let index = 0; index < phases.length; index += 1) {
      positionAttribute.setY(index, baseY[index] + Math.sin(time * 3.4 + phases[index]) * 0.1);
    }
    positionAttribute.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[crowd.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[crowd.colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.22} vertexColors transparent opacity={0.92} sizeAttenuation />
    </points>
  );
}

function StadiumCameraFlashes() {
  const flashRefs = useRef<Array<PointLight | null>>([]);
  const flashData = useMemo(
    () => Array.from({ length: 12 }, (_, index) => ({
      position: [
        (index % 2 === 0 ? -1 : 1) * (14.8 + Math.random() * 5.4),
        4.6 + Math.random() * 2.6,
        14 - index * 12 - Math.random() * 10
      ] as [number, number, number],
      nextFlashAt: Math.random() * 3
    })),
    []
  );

  useFrame(({ clock }, delta) => {
    const time = clock.elapsedTime;
    flashData.forEach((flash, index) => {
      const light = flashRefs.current[index];
      if (!light) {
        return;
      }
      light.intensity = Math.max(0, light.intensity - delta * 42);
      if (time >= flash.nextFlashAt) {
        light.intensity = 16 + Math.random() * 18;
        flash.nextFlashAt = time + 0.45 + Math.random() * 2.6;
      }
    });
  });

  return (
    <group>
      {flashData.map((flash, index) => (
        <pointLight
          key={`stadium-flash-${index}`}
          ref={(light) => {
            flashRefs.current[index] = light;
          }}
          position={flash.position}
          color="#ffffff"
          intensity={0}
          distance={12}
          decay={2}
        />
      ))}
    </group>
  );
}

function StadiumGrandstands() {
  const standSections = useMemo(
    () => Array.from({ length: 13 }, (_, index) => 18 - index * 18),
    []
  );
  const rows = useMemo(() => Array.from({ length: 6 }, (_, index) => index), []);

  return (
    <group>
      {standSections.map((z) => (
        <group key={`grandstand-section-${z}`}>
          {[-1, 1].map((side) => (
            <group key={`grandstand-${side}-${z}`} position={[side * 16.7, 0, z]}>
              {rows.map((row) => (
                <mesh key={`stand-row-${row}`} position={[side * row * 0.72, 0.45 + row * 0.46, 0]} castShadow receiveShadow>
                  <boxGeometry args={[2.2, 0.5, 15.5]} />
                  <meshStandardMaterial
                    color={row % 2 === 0 ? "#334155" : "#475569"}
                    roughness={0.82}
                    metalness={0.06}
                  />
                </mesh>
              ))}
              <mesh position={[side * 2.4, 4.2, 0]} castShadow>
                <boxGeometry args={[0.34, 4.7, 16.2]} />
                <meshStandardMaterial color="#111827" roughness={0.74} metalness={0.25} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
      {[-1, 1].map((side) => (
        <group key={`stadium-lights-${side}`}>
          {[12, -42, -96, -150].map((z) => (
            <group key={`floodlight-${side}-${z}`} position={[side * 20.5, 9.8, z]}>
              <mesh castShadow>
                <boxGeometry args={[0.42, 9, 0.42]} />
                <meshStandardMaterial color="#1f2937" roughness={0.5} metalness={0.45} />
              </mesh>
              <mesh position={[-side * 0.62, 4.75, 0]} rotation-z={side * 0.28}>
                <boxGeometry args={[2.2, 0.8, 1.2]} />
                <meshStandardMaterial color="#f8fafc" emissive="#ffffff" emissiveIntensity={1.4} toneMapped={false} />
              </mesh>
              <spotLight
                position={[-side * 0.75, 4.55, 0]}
                target-position={[0, 0, z - 4]}
                color="#ffffff"
                intensity={95}
                distance={58}
                angle={0.5}
                penumbra={0.75}
              />
            </group>
          ))}
        </group>
      ))}
      <StadiumCrowd />
      <StadiumCameraFlashes />
    </group>
  );
}

function StadiumAtmosphereAudio() {
  const trackTheme = useGameStore((state) => state.trackTheme);
  const answerFeedback = useGameStore((state) => state.answerFeedback);
  const racePhase = useGameStore((state) => state.racePhase);
  const playerId = useGameStore((state) => state.playerId);
  const localPlayerFinished = useGameStore((state) => {
    const localPlayer = state.players[state.playerId];
    return Boolean(localPlayer?.finished || (state.winnerPlayerId && state.winnerPlayerId === state.playerId));
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fallbackGainRef = useRef<GainNode | null>(null);
  const fallbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const boostTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (boostTimeoutRef.current !== null) {
        window.clearTimeout(boostTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (trackTheme !== "grand_prix") {
      audioRef.current?.pause();
      fallbackGainRef.current?.gain.setTargetAtTime(0, audioContextRef.current?.currentTime ?? 0, 0.08);
      return undefined;
    }

    const audio = new Audio("/assets/audio/crowd_cheer_loop.mp3");
    audio.loop = true;
    audio.volume = 0.22;
    audioRef.current = audio;
    void audio.play().catch(() => {
      const audioWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
      const AudioContextConstructor = audioWindow.AudioContext || audioWindow.webkitAudioContext;
      if (!AudioContextConstructor || audioContextRef.current) {
        return;
      }
      const audioContext = new AudioContextConstructor();
      const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < channel.length; index += 1) {
        channel[index] = (Math.random() * 2 - 1) * 0.16;
      }
      const source = audioContext.createBufferSource();
      const gain = audioContext.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = 0.035;
      source.connect(gain);
      gain.connect(audioContext.destination);
      source.start();
      audioContextRef.current = audioContext;
      fallbackSourceRef.current = source;
      fallbackGainRef.current = gain;
    });

    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
      fallbackSourceRef.current?.stop();
      fallbackSourceRef.current = null;
      fallbackGainRef.current?.disconnect();
      fallbackGainRef.current = null;
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, [trackTheme]);

  useEffect(() => {
    if (trackTheme !== "grand_prix") {
      return;
    }
    const shouldBoost = Boolean(
      (answerFeedback?.correct && answerFeedback.accepted)
      || localPlayerFinished
      || (racePhase === "finish" && playerId)
    );
    if (!shouldBoost) {
      return;
    }

    if (boostTimeoutRef.current !== null) {
      window.clearTimeout(boostTimeoutRef.current);
    }
    if (audioRef.current) {
      audioRef.current.volume = 0.54;
    }
    if (fallbackGainRef.current && audioContextRef.current) {
      fallbackGainRef.current.gain.setTargetAtTime(0.09, audioContextRef.current.currentTime, 0.05);
    }
    boostTimeoutRef.current = window.setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.volume = 0.22;
      }
      if (fallbackGainRef.current && audioContextRef.current) {
        fallbackGainRef.current.gain.setTargetAtTime(0.035, audioContextRef.current.currentTime, 0.22);
      }
    }, 1500);
  }, [answerFeedback?.receivedAtMs, answerFeedback?.correct, answerFeedback?.accepted, localPlayerFinished, playerId, racePhase, trackTheme]);

  return null;
}

function EnvironmentManager({ theme }: { theme: TrackTheme }) {
  return (
    <ManagedEnvironmentAssets key={theme}>
      {theme === "sunny-forest" ? <SunnyForestProps /> : null}
      {theme === "snow-peak" ? <Snowfall /> : null}
      {theme === "fun-world" ? <FunWorldProps /> : null}
      {theme === "grand_prix" ? <StadiumGrandstands /> : null}
    </ManagedEnvironmentAssets>
  );
}

function NeonTrack({ environment }: { environment: EnvironmentConfig }) {
  const dashSegments = useMemo(
    () => Array.from({ length: 340 }, (_, index) => -(index * 6)),
    []
  );
  const sidePillars = useMemo(
    () => Array.from({ length: 40 }, (_, index) => -20 - index * 28),
    []
  );

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, 0, -900]}>
        <planeGeometry args={[24, 2600]} />
        <meshStandardMaterial color={environment.trackSurface} roughness={0.95} metalness={0.04} />
      </mesh>
      {environment.trackPattern === "checker" ? (
        <group>
          {Array.from({ length: 56 }, (_, index) => {
            const z = 18 - index * 16;
            return (
              <group key={`fun-checker-${index}`}>
                <mesh rotation-x={-Math.PI / 2} position={[-3, 0.011, z]} receiveShadow>
                  <planeGeometry args={[6, 8]} />
                  <meshStandardMaterial color={index % 2 === 0 ? "#ffb3e2" : "#ffe866"} roughness={0.82} />
                </mesh>
                <mesh rotation-x={-Math.PI / 2} position={[3, 0.011, z]} receiveShadow>
                  <planeGeometry args={[6, 8]} />
                  <meshStandardMaterial color={index % 2 === 0 ? "#ffe866" : "#ffb3e2"} roughness={0.82} />
                </mesh>
              </group>
            );
          })}
        </group>
      ) : null}

      {dashSegments.map((z) => (
        <mesh key={`lane-mid-${z}`} position={[0, 0.03, z]} receiveShadow>
          <boxGeometry args={[0.2, 0.02, 2.1]} />
          <meshStandardMaterial color={environment.lane} roughness={0.82} metalness={0.04} />
        </mesh>
      ))}

      {dashSegments.map((z) => (
        <group key={`lane-side-${z}`}>
          <mesh position={[-4.15, 0.03, z]} receiveShadow>
            <boxGeometry args={[0.15, 0.02, 3]} />
            <meshStandardMaterial color={environment.sideLane} roughness={0.86} metalness={0.04} />
          </mesh>
          <mesh position={[4.15, 0.03, z]} receiveShadow>
            <boxGeometry args={[0.15, 0.02, 3]} />
            <meshStandardMaterial color={environment.sideLane} roughness={0.86} metalness={0.04} />
          </mesh>
        </group>
      ))}

      {!environment.stadium ? (
        sidePillars.map((z) => (
          <group key={`pillar-${z}`}>
            <mesh position={[-9.5, 1.8, z]}>
              <boxGeometry args={[0.45, 3.6, 0.45]} />
              <meshStandardMaterial color={environment.pillar} roughness={0.84} metalness={0.08} />
            </mesh>
            <mesh position={[-9.5, 3.8, z]}>
              <sphereGeometry args={[0.24, 16, 16]} />
              <meshStandardMaterial color={environment.lantern} emissive={environment.lanternEmissive} emissiveIntensity={0.18} />
            </mesh>
            <mesh position={[9.5, 1.8, z]}>
              <boxGeometry args={[0.45, 3.6, 0.45]} />
              <meshStandardMaterial color={environment.pillar} roughness={0.84} metalness={0.08} />
            </mesh>
            <mesh position={[9.5, 3.8, z]}>
              <sphereGeometry args={[0.24, 16, 16]} />
              <meshStandardMaterial color={environment.lantern} emissive={environment.lanternEmissive} emissiveIntensity={0.16} />
            </mesh>
          </group>
        ))
      ) : null}
    </group>
  );
}

function LobbyBay({ environment }: { environment: EnvironmentConfig }) {
  const racePhase = useGameStore((state) => state.racePhase);
  const padSlots = useMemo(
    () => Array.from({ length: 4 }, (_, index) => getLobbySlotPosition(index, 4)),
    []
  );

  if (racePhase !== "lobby" && racePhase !== "starting") {
    return null;
  }

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, 0.01, 14.2]}>
        <planeGeometry args={[22, 16]} />
        <meshStandardMaterial color="#0c1328" roughness={0.9} metalness={0.14} />
      </mesh>

      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 7.5]}>
        <planeGeometry args={[18, 0.56]} />
        <meshStandardMaterial color={environment.lobbyMarker} roughness={0.82} metalness={0.02} transparent opacity={0.32} />
      </mesh>

      {padSlots.map(([x, , z], index) => (
        <group key={`lobby-pad-${index}`}>
          <mesh position={[x, 0.14, z]} receiveShadow>
            <boxGeometry args={[3.8, 0.18, 5.4]} />
            <meshStandardMaterial color="#121a34" emissive="#121a34" emissiveIntensity={0.26} />
          </mesh>
          <mesh position={[x, 0.2, z]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.25, 1.72, 48]} />
            <meshBasicMaterial color={environment.padRing} transparent opacity={0.1} />
          </mesh>
        </group>
      ))}

      <mesh position={[0, 2.8, 6.9]}>
        <boxGeometry args={[13.8, 0.34, 0.32]} />
        <meshStandardMaterial color={environment.lobbyBar} roughness={0.78} metalness={0.04} transparent opacity={0.52} />
      </mesh>
      <mesh position={[-6.8, 1.6, 7.2]}>
        <boxGeometry args={[0.35, 3.2, 0.35]} />
        <meshStandardMaterial color="#101c39" emissive="#101c39" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[6.8, 1.6, 7.2]}>
        <boxGeometry args={[0.35, 3.2, 0.35]} />
        <meshStandardMaterial color="#101c39" emissive="#101c39" emissiveIntensity={0.3} />
      </mesh>

      <Text
        position={[0, 4.15, 7.1]}
        fontSize={0.56}
        color="#e8fbff"
        anchorX="center"
        anchorY="middle"
        fontWeight={800}
        letterSpacing={0.07}
      >
        WAITING GRID
      </Text>
      <Text position={[0, 3.5, 7.1]} fontSize={0.22} color="#ffd58d" anchorX="center" anchorY="middle">
        Stage cars here before the run starts
      </Text>
    </group>
  );
}

function SideProgressMarkers({ environment }: { environment: EnvironmentConfig }) {
  const racePhase = useGameStore((state) => state.racePhase);
  const trackLengthMeters = useGameStore((state) => state.trackLengthMeters);
  const totalLaps = useGameStore((state) => state.totalLaps);
  const { localPlayer } = useRenderedPlayers();
  const markers = useMemo(
    () =>
      Array.from({ length: 10 }, (_, index) => {
        const step = index + 1;
        const progressRatio = step / 10;
        const progressPercent = step * 10;
        return {
          key: `progress-${progressPercent}`,
          progressRatio,
          progressLabel: `${progressPercent}%`,
          z: -(trackLengthMeters * progressRatio) * TRACK_Z_SCALE + (step === 10 ? 1.2 : 0)
        };
      }),
    [trackLengthMeters]
  );

  if (racePhase !== "active" && racePhase !== "finish") {
    return null;
  }

  const overallProgressRatio = getPlayerProgressRatio(localPlayer, trackLengthMeters, totalLaps);

  return (
    <group>
      {markers.map((marker) => {
        const approachFactor = MathUtils.clamp(
          1 - (Math.abs(overallProgressRatio - marker.progressRatio) / 0.12),
          0,
          1
        );
        const isPassed = marker.progressRatio <= overallProgressRatio;
        const panelColor = marker.progressRatio >= 1 ? environment.progressFinish : isPassed ? environment.progressPassed : environment.progressIdle;
        const panelEmissive = marker.progressRatio >= 1
          ? environment.progressFinish
          : (isPassed || approachFactor > 0 ? environment.progressActive : environment.progressIdle);
        const panelEmissiveIntensity = marker.progressRatio >= 1
          ? 0.18
          : 0.04 + (isPassed ? 0.08 : 0) + (approachFactor * 0.08);
        const textColor = marker.progressRatio >= 1
          ? "#a9ffd0"
          : (isPassed || approachFactor >= 0.65 ? "#b9f5ff" : "#ffd58d");

        return (
          <group key={marker.key} position={[0, 0, marker.z]}>
            <mesh position={[-7.7, 2.2, 0]} castShadow receiveShadow>
              <boxGeometry args={[1.6, 0.84, 0.12]} />
              <meshStandardMaterial
                color={panelColor}
                emissive={panelEmissive}
                emissiveIntensity={panelEmissiveIntensity}
              />
            </mesh>
            <mesh position={[7.7, 2.2, 0]} castShadow receiveShadow>
              <boxGeometry args={[1.6, 0.84, 0.12]} />
              <meshStandardMaterial
                color={panelColor}
                emissive={panelEmissive}
                emissiveIntensity={panelEmissiveIntensity}
              />
            </mesh>

            <Text
              position={[-7.7, 2.2, 0.08]}
              rotation={[0, Math.PI / 2, 0]}
              fontSize={0.38}
              color={textColor}
              anchorX="center"
              anchorY="middle"
            >
              {marker.progressLabel}
            </Text>
            <Text
              position={[7.7, 2.2, 0.08]}
              rotation={[0, -Math.PI / 2, 0]}
              fontSize={0.38}
              color={textColor}
              anchorX="center"
              anchorY="middle"
            >
              {marker.progressLabel}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

function FinishGate({ environment }: { environment: EnvironmentConfig }) {
  const racePhase = useGameStore((state) => state.racePhase);
  const trackLengthMeters = useGameStore((state) => state.trackLengthMeters);
  const totalLaps = useGameStore((state) => state.totalLaps);
  const { localPlayer } = useRenderedPlayers();
  const glowRef = useRef<PointLight>(null);
  const gateVisible = racePhase === "active" || racePhase === "finish";
  const finishTiles = useMemo(() => Array.from({ length: 12 }, (_, index) => index), []);

  const progressRatio = getPlayerProgressRatio(localPlayer, trackLengthMeters, totalLaps);
  const distanceToFinishMeters = getDistanceToFinishMeters(localPlayer, trackLengthMeters, totalLaps);
  const gateApproachFactor = MathUtils.clamp(1 - (distanceToFinishMeters / 260), 0, 1);
  const finalLapActive = isPlayerOnFinalLap(localPlayer, trackLengthMeters, totalLaps);
  const raceFinished = Boolean(localPlayer && (localPlayer.finished || progressRatio >= 0.999));
  const gateColor = raceFinished ? environment.progressFinish : finalLapActive ? environment.accent : environment.sideLane;
  const supportColor = raceFinished ? environment.progressFinish : finalLapActive ? environment.accent : environment.lobbyBar;
  const haloOpacity = raceFinished ? 0.12 : finalLapActive ? 0.08 + gateApproachFactor * 0.04 : 0.06 + gateApproachFactor * 0.02;
  const gateZ = -trackLengthMeters * TRACK_Z_SCALE;

  useFrame(({ clock }) => {
    if (!gateVisible || !glowRef.current) {
      return;
    }
    const pulseSpeed = raceFinished
      ? 4.2
      : finalLapActive
        ? 5.2 + gateApproachFactor
        : 2.4 + gateApproachFactor * 1.2;
    const pulse = 0.82 + Math.sin(clock.getElapsedTime() * pulseSpeed) * 0.22;
    const baseIntensity = raceFinished
      ? 1.2
      : finalLapActive
        ? 1.4 + gateApproachFactor * 0.4
        : 0.9 + gateApproachFactor * 0.2;
    glowRef.current.intensity = Math.max(0.1, baseIntensity * pulse);
  });

  if (!gateVisible) {
    return null;
  }

  return (
    <group>
      <group position={[0, 0.03, gateZ + 1.45]}>
        {finishTiles.map((tile) => (
          <mesh key={`finish-tile-${tile}`} position={[-10.35 + tile * 1.88, 0, 0]} receiveShadow>
            <boxGeometry args={[1.72, 0.02, 1.45]} />
            <meshStandardMaterial
              color={tile % 2 === 0 ? "#f8fafc" : "#0c1328"}
              emissive={tile % 2 === 0 ? "#d7f7ff" : "#0c1328"}
              emissiveIntensity={tile % 2 === 0 ? 0.1 : 0.2}
            />
          </mesh>
        ))}
      </group>

      <group position={[0, 2.6, gateZ]}>
        <mesh castShadow receiveShadow position={[-5.9, 0, 0]}>
          <boxGeometry args={[0.55, 5.2, 0.55]} />
          <meshStandardMaterial color="#0f1b38" emissive="#0f1b38" emissiveIntensity={0.35} />
        </mesh>
        <mesh castShadow receiveShadow position={[5.9, 0, 0]}>
          <boxGeometry args={[0.55, 5.2, 0.55]} />
          <meshStandardMaterial color="#0f1b38" emissive="#0f1b38" emissiveIntensity={0.35} />
        </mesh>

        <mesh castShadow receiveShadow position={[0, 2.4, 0]}>
          <boxGeometry args={[12.8, 0.7, 0.62]} />
          <meshStandardMaterial
            color={gateColor}
            emissive={gateColor}
            emissiveIntensity={raceFinished ? 0.22 : finalLapActive ? 0.16 + gateApproachFactor * 0.08 : 0.12 + gateApproachFactor * 0.04}
            metalness={0.35}
          />
        </mesh>
        <mesh position={[0, 2.41, -0.12]}>
          <boxGeometry args={[11.7, 0.18, 0.12]} />
          <meshStandardMaterial
            color={supportColor}
            emissive={supportColor}
            emissiveIntensity={raceFinished ? 0.32 : finalLapActive ? 0.24 + gateApproachFactor * 0.12 : 0.2}
          />
        </mesh>

        <mesh position={[-5.9, 2.7, 0]}>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial
            color={supportColor}
            emissive={supportColor}
            emissiveIntensity={raceFinished ? 0.42 : finalLapActive ? 0.34 + gateApproachFactor * 0.12 : 0.28}
          />
        </mesh>
        <mesh position={[5.9, 2.7, 0]}>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial
            color={supportColor}
            emissive={supportColor}
            emissiveIntensity={raceFinished ? 0.42 : finalLapActive ? 0.34 + gateApproachFactor * 0.12 : 0.28}
          />
        </mesh>

        <mesh position={[0, -2.56, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[4.9, 7.5, 52]} />
          <meshBasicMaterial color={gateColor} transparent opacity={haloOpacity} />
        </mesh>
        <pointLight ref={glowRef} color={gateColor} distance={18} position={[0, 1.95, 0]} />
      </group>
    </group>
  );
}

function CameraRig() {
  const desiredCameraRef = useRef(new Vector3(0, 4.5, 12));
  const lookAtRef = useRef(new Vector3(0, 1, -12));

  useFrame(({ camera }, delta) => {
    const game = useGameStore.getState();
    const localPlayer = game.players[game.playerId];
    if (!localPlayer) {
      return;
    }

    const nowMs = Date.now();
    if (game.racePhase === "lobby" || game.racePhase === "starting") {
      const slotIndex = Math.max(0, game.playerIds.indexOf(game.playerId));
      const transform = getLobbyToTrackTransform(
        slotIndex,
        Math.max(1, game.playerIds.length),
        localPlayer.laneIndex,
        game.racePhase,
        game.raceStartingAtMs,
        nowMs
      );

      desiredCameraRef.current.set(
        MathUtils.lerp(0, transform.x * 0.35, transform.easedProgress),
        MathUtils.lerp(5.4, 4.1, transform.easedProgress),
        MathUtils.lerp(transform.lobbyZ + 9.8, transform.z + 11.5, transform.easedProgress)
      );
      camera.position.lerp(desiredCameraRef.current, 1 - Math.exp(-delta * 4.6));

      lookAtRef.current.set(
        transform.x,
        MathUtils.lerp(1.4, 0.95, transform.easedProgress),
        MathUtils.lerp(transform.lobbyZ - 4.2, transform.z - 20, transform.easedProgress)
      );
      camera.lookAt(lookAtRef.current);

      const perspectiveCamera = camera as PerspectiveCamera;
      perspectiveCamera.fov = MathUtils.lerp(
        perspectiveCamera.fov,
        MathUtils.lerp(47, 58, transform.easedProgress),
        1 - Math.exp(-delta * 5)
      );
      perspectiveCamera.updateProjectionMatrix();
      return;
    }

    const renderedLocalPlayer = getRenderedPlayersSnapshot().localPlayer;
    if (!renderedLocalPlayer) {
      return;
    }

    const speedFactor = Math.min(1.0, renderedLocalPlayer.speedMps / 110);
    const targetX = laneToX(renderedLocalPlayer.laneIndex);
    const targetZ = -renderedLocalPlayer.positionMeters * TRACK_Z_SCALE;

    desiredCameraRef.current.set(
      targetX * 0.55,
      3.9 + speedFactor * 1.4,
      targetZ + 11 - speedFactor * 3
    );
    camera.position.lerp(desiredCameraRef.current, 1 - Math.exp(-delta * 4.4));

    lookAtRef.current.set(targetX, 0.8 + speedFactor * 0.4, targetZ - 22 - speedFactor * 9);
    camera.lookAt(lookAtRef.current);

    const perspectiveCamera = camera as PerspectiveCamera;
    perspectiveCamera.fov = MathUtils.lerp(
      perspectiveCamera.fov,
      56 + speedFactor * 14,
      1 - Math.exp(-delta * 5.5)
    );
    perspectiveCamera.updateProjectionMatrix();
  });

  return null;
}

function SkyboxGradient({ environment }: { environment: EnvironmentConfig }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, environment.background);
      gradient.addColorStop(0.42, environment.fog);
      gradient.addColorStop(1, "#02030a");
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    return new CanvasTexture(canvas);
  }, [environment]);

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  return (
    <mesh scale={[360, 360, 360]}>
      <sphereGeometry args={[1, 32, 16]} />
      <meshBasicMaterial map={texture} side={BackSide} depthWrite={false} />
    </mesh>
  );
}

export function RaceScene() {
  const trackTheme = useGameStore((state) => state.trackTheme);
  const selectedCarId = useGameStore((state) => state.selectedCarId);
  const environment = ENVIRONMENTS[trackTheme] ?? ENVIRONMENTS["sunny-forest"];

  useEffect(() => {
    const selectedCar = getGarageCarById(selectedCarId);
    useGLTF.preload(selectedCar.url);
  }, [selectedCarId]);

  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ position: [0, 4.5, 12], fov: 58 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.shadowMap.enabled = true;
        gl.shadowMap.type = PCFSoftShadowMap;
      }}
    >
      <color attach="background" args={[environment.background]} />
      <fog attach="fog" args={[environment.fog, environment.fogNear, environment.fogFar]} />
      <SkyboxGradient environment={environment} />
      <ambientLight color={environment.ambient} intensity={environment.ambientIntensity} />
      <directionalLight
        position={[5, 12, 6]}
        color={environment.directional}
        intensity={environment.directionalIntensity}
        castShadow
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-bias={-0.00015}
        shadow-normalBias={0.03}
      />
      {environment.pointLights.map((light, index) => (
        <pointLight
          key={`${trackTheme}-point-${index}`}
          position={light.position}
          color={light.color}
          intensity={light.intensity}
          distance={light.distance}
        />
      ))}

      <NeonTrack environment={environment} />
      <EnvironmentManager theme={trackTheme} />
      <StadiumAtmosphereAudio />
      <LobbyBay environment={environment} />
      <SideProgressMarkers environment={environment} />
      <FinishGate environment={environment} />
      <Suspense fallback={null}>
        <CarsLayer />
      </Suspense>
      <CameraRig />
      <Sparkles count={70} color={environment.sparkles} scale={[90, 25, 280]} size={2.4} speed={0.45} />

      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.22} luminanceThreshold={0.78} luminanceSmoothing={0.28} />
        <Vignette eskil={false} offset={0.12} darkness={0.86} />
      </EffectComposer>
      <RaceLoadingOverlay />
    </Canvas>
  );
}
