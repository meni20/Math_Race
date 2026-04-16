import { Sparkles, Text } from "@react-three/drei";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { Canvas, useFrame } from "@react-three/fiber";
import { Group, MathUtils, PerspectiveCamera, PointLight, Vector3 } from "three";
import { useMemo, useRef } from "react";
import { useGameStore } from "../store/useGameStore";
import { getRenderedPlayerSnapshot } from "../utils/renderMotion";

const TRACK_Z_SCALE = 0.24;
const LANE_WIDTH = 2.8;

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

const WHEEL_POSITIONS: Array<[number, number, number]> = [
  [-0.72, 0.26, -0.92],
  [0.72, 0.26, -0.92],
  [-0.72, 0.26, 0.9],
  [0.72, 0.26, 0.9]
];

function NeonCarModel({ color }: { color: string }) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.5, 0]}>
        <boxGeometry args={[1.52, 0.3, 2.9]} />
        <meshStandardMaterial
          color="#0b1329"
          emissive="#0b1329"
          emissiveIntensity={0.35}
          metalness={0.72}
          roughness={0.34}
        />
      </mesh>

      <mesh castShadow receiveShadow position={[0, 0.74, -0.06]}>
        <boxGeometry args={[1.22, 0.34, 2.2]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.46}
          metalness={0.58}
          roughness={0.23}
        />
      </mesh>

      <mesh castShadow receiveShadow position={[0, 0.95, -0.14]}>
        <boxGeometry args={[0.98, 0.3, 1.1]} />
        <meshStandardMaterial
          color="#121f3e"
          emissive="#0f1a36"
          emissiveIntensity={0.3}
          metalness={0.32}
          roughness={0.28}
        />
      </mesh>

      <mesh position={[0, 1.08, -0.1]}>
        <boxGeometry args={[0.84, 0.05, 0.86]} />
        <meshStandardMaterial
          color="#8be7ff"
          emissive="#8be7ff"
          emissiveIntensity={0.2}
          metalness={0.14}
          roughness={0.08}
        />
      </mesh>

      <mesh castShadow receiveShadow position={[0, 1, 1.12]}>
        <boxGeometry args={[1.08, 0.06, 0.2]} />
        <meshStandardMaterial
          color="#0e1630"
          emissive="#0e1630"
          emissiveIntensity={0.25}
          metalness={0.45}
          roughness={0.35}
        />
      </mesh>

      <mesh castShadow receiveShadow position={[0, 0.9, 1.2]}>
        <boxGeometry args={[0.82, 0.18, 0.12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.42}
          metalness={0.48}
          roughness={0.3}
        />
      </mesh>

      <mesh position={[-0.56, 0.68, -0.02]}>
        <boxGeometry args={[0.04, 0.07, 2.2]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.95} />
      </mesh>
      <mesh position={[0.56, 0.68, -0.02]}>
        <boxGeometry args={[0.04, 0.07, 2.2]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.95} />
      </mesh>

      <mesh position={[-0.34, 0.75, -1.36]}>
        <boxGeometry args={[0.24, 0.09, 0.08]} />
        <meshStandardMaterial color="#8be7ff" emissive="#8be7ff" emissiveIntensity={2.4} />
      </mesh>
      <mesh position={[0.34, 0.75, -1.36]}>
        <boxGeometry args={[0.24, 0.09, 0.08]} />
        <meshStandardMaterial color="#8be7ff" emissive="#8be7ff" emissiveIntensity={2.4} />
      </mesh>

      <mesh position={[-0.34, 0.74, 1.34]}>
        <boxGeometry args={[0.22, 0.08, 0.07]} />
        <meshStandardMaterial color="#ff5a74" emissive="#ff5a74" emissiveIntensity={2.2} />
      </mesh>
      <mesh position={[0.34, 0.74, 1.34]}>
        <boxGeometry args={[0.22, 0.08, 0.07]} />
        <meshStandardMaterial color="#ff5a74" emissive="#ff5a74" emissiveIntensity={2.2} />
      </mesh>

      <mesh position={[0, 0.24, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.88, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.24} />
      </mesh>

      {WHEEL_POSITIONS.map((position, index) => (
        <group key={`wheel-${index}`} position={position}>
          <mesh castShadow receiveShadow rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.27, 0.27, 0.26, 24]} />
            <meshStandardMaterial
              color="#050a18"
              emissive="#050a18"
              emissiveIntensity={0.15}
              metalness={0.28}
              roughness={0.85}
            />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.19, 0.04, 12, 24]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.58} metalness={0.55} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.09, 0.09, 0.27, 18]} />
            <meshStandardMaterial color="#d8f8ff" emissive="#d8f8ff" emissiveIntensity={0.12} metalness={0.42} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function CarEntity({ playerId }: { playerId: string }) {
  const groupRef = useRef<Group>(null);
  const speedRef = useRef(0);
  const positionRef = useRef(0);
  const color = useMemo(() => hashColor(playerId), [playerId]);

  useFrame((_, delta) => {
    const state = useGameStore.getState();
    const player = getRenderedPlayerSnapshot(
      state.players[playerId],
      state.playerSyncMeta[playerId],
      state.localMotionPrediction,
      state.trackLengthMeters,
      state.raceStopped,
      Date.now()
    );
    if (!player || !groupRef.current) {
      return;
    }

    speedRef.current = MathUtils.damp(speedRef.current, player.speedMps, 8.5, delta);
    positionRef.current = MathUtils.damp(positionRef.current, player.positionMeters, 10.5, delta);

    const z = -positionRef.current * TRACK_Z_SCALE;
    const x = laneToX(player.laneIndex);
    groupRef.current.position.set(x, 0.7, z);
    groupRef.current.rotation.x = Math.min(0.04, speedRef.current / 3000);
    groupRef.current.scale.z = 1 + Math.min(0.45, speedRef.current / 200);
  });

  return (
    <group ref={groupRef}>
      <NeonCarModel color={color} />
      <pointLight color={color} intensity={5.4} distance={15} position={[0, 0.95, 0]} />
    </group>
  );
}

function CarsLayer() {
  const playerIds = useGameStore((state) => state.playerIds);
  return (
    <group>
      {playerIds.map((playerId) => (
        <CarEntity key={playerId} playerId={playerId} />
      ))}
    </group>
  );
}

function NeonTrack() {
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
        <meshStandardMaterial color="#11172d" roughness={0.95} metalness={0.06} />
      </mesh>

      {dashSegments.map((z) => (
        <mesh key={`lane-mid-${z}`} position={[0, 0.03, z]} receiveShadow>
          <boxGeometry args={[0.2, 0.02, 2.1]} />
          <meshStandardMaterial color="#28f6ff" emissive="#28f6ff" emissiveIntensity={0.7} />
        </mesh>
      ))}

      {dashSegments.map((z) => (
        <group key={`lane-side-${z}`}>
          <mesh position={[-4.15, 0.03, z]} receiveShadow>
            <boxGeometry args={[0.15, 0.02, 3]} />
            <meshStandardMaterial color="#ffc543" emissive="#ffc543" emissiveIntensity={0.42} />
          </mesh>
          <mesh position={[4.15, 0.03, z]} receiveShadow>
            <boxGeometry args={[0.15, 0.02, 3]} />
            <meshStandardMaterial color="#ffc543" emissive="#ffc543" emissiveIntensity={0.42} />
          </mesh>
        </group>
      ))}

      {sidePillars.map((z) => (
        <group key={`pillar-${z}`}>
          <mesh position={[-9.5, 1.8, z]}>
            <boxGeometry args={[0.45, 3.6, 0.45]} />
            <meshStandardMaterial color="#0f1b38" emissive="#0f1b38" emissiveIntensity={0.25} />
          </mesh>
          <mesh position={[-9.5, 3.8, z]}>
            <sphereGeometry args={[0.24, 16, 16]} />
            <meshStandardMaterial color="#ff5468" emissive="#ff5468" emissiveIntensity={2} />
          </mesh>
          <mesh position={[9.5, 1.8, z]}>
            <boxGeometry args={[0.45, 3.6, 0.45]} />
            <meshStandardMaterial color="#0f1b38" emissive="#0f1b38" emissiveIntensity={0.25} />
          </mesh>
          <mesh position={[9.5, 3.8, z]}>
            <sphereGeometry args={[0.24, 16, 16]} />
            <meshStandardMaterial color="#28f6ff" emissive="#28f6ff" emissiveIntensity={2} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function SideProgressMarkers() {
  const trackLengthMeters = useGameStore((state) => state.trackLengthMeters);
  const totalLaps = useGameStore((state) => state.totalLaps);
  const playerId = useGameStore((state) => state.playerId);
  const players = useGameStore((state) => state.players);

  const localPlayer = players[playerId];
  const totalRaceDistance = Math.max(1, trackLengthMeters * Math.max(1, totalLaps));
  const overallProgressRatio = localPlayer
    ? Math.min(
      1,
      Math.max(
        0,
        ((localPlayer.lap * trackLengthMeters) + localPlayer.positionMeters) / totalRaceDistance
      )
    )
    : 0;
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

  return (
    <group>
      {markers.map((marker) => {
        const isPassed = marker.progressRatio <= overallProgressRatio;
        const panelColor = marker.progressRatio >= 1 ? "#1f5231" : isPassed ? "#13405f" : "#0f1b38";
        const panelEmissive = marker.progressRatio >= 1 ? "#64ff84" : isPassed ? "#28f6ff" : "#0f1b38";
        const textColor = marker.progressRatio >= 1 ? "#a9ffd0" : isPassed ? "#b9f5ff" : "#ffd58d";

        return (
          <group key={marker.key} position={[0, 0, marker.z]}>
            <mesh position={[-7.7, 2.2, 0]} castShadow receiveShadow>
              <boxGeometry args={[1.6, 0.84, 0.12]} />
              <meshStandardMaterial color={panelColor} emissive={panelEmissive} emissiveIntensity={0.45} />
            </mesh>
            <mesh position={[7.7, 2.2, 0]} castShadow receiveShadow>
              <boxGeometry args={[1.6, 0.84, 0.12]} />
              <meshStandardMaterial color={panelColor} emissive={panelEmissive} emissiveIntensity={0.45} />
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

function FinishGate() {
  const trackLengthMeters = useGameStore((state) => state.trackLengthMeters);
  const totalLaps = useGameStore((state) => state.totalLaps);
  const playerId = useGameStore((state) => state.playerId);
  const players = useGameStore((state) => state.players);

  const localPlayer = players[playerId];
  const finalLapActive = Boolean(
    localPlayer && !localPlayer.finished && localPlayer.lap >= Math.max(0, totalLaps - 1)
  );
  const raceFinished = Boolean(localPlayer?.finished);
  const gateColor = raceFinished ? "#64ff84" : finalLapActive ? "#28f6ff" : "#ffc543";
  const supportColor = raceFinished ? "#95ffbe" : finalLapActive ? "#8be7ff" : "#ffd58d";
  const haloOpacity = raceFinished ? 0.32 : finalLapActive ? 0.24 : 0.14;
  const glowRef = useRef<PointLight>(null);
  const finishTiles = useMemo(() => Array.from({ length: 12 }, (_, index) => index), []);
  const gateZ = -trackLengthMeters * TRACK_Z_SCALE;

  useFrame(({ clock }) => {
    if (!glowRef.current) {
      return;
    }
    const pulseSpeed = raceFinished ? 4.2 : finalLapActive ? 6.2 : 2.4;
    const pulse = 0.82 + Math.sin(clock.getElapsedTime() * pulseSpeed) * 0.22;
    const baseIntensity = raceFinished ? 6.4 : finalLapActive ? 10.8 : 5.2;
    glowRef.current.intensity = Math.max(0.1, baseIntensity * pulse);
  });

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
          <meshStandardMaterial color={gateColor} emissive={gateColor} emissiveIntensity={0.64} metalness={0.35} />
        </mesh>
        <mesh position={[0, 2.41, -0.12]}>
          <boxGeometry args={[11.7, 0.18, 0.12]} />
          <meshStandardMaterial color={supportColor} emissive={supportColor} emissiveIntensity={1.55} />
        </mesh>

        <mesh position={[-5.9, 2.7, 0]}>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial color={supportColor} emissive={supportColor} emissiveIntensity={2.3} />
        </mesh>
        <mesh position={[5.9, 2.7, 0]}>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial color={supportColor} emissive={supportColor} emissiveIntensity={2.3} />
        </mesh>

        <mesh position={[0, -2.56, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[4.9, 7.5, 52]} />
          <meshBasicMaterial color={gateColor} transparent opacity={haloOpacity} />
        </mesh>
        <pointLight ref={glowRef} color={gateColor} distance={40} position={[0, 1.95, 0]} />
      </group>
    </group>
  );
}

function CameraRig() {
  const desiredCameraRef = useRef(new Vector3(0, 4.5, 12));
  const lookAtRef = useRef(new Vector3(0, 1, -12));

  useFrame(({ camera }, delta) => {
    const game = useGameStore.getState();
    const localPlayer = getRenderedPlayerSnapshot(
      game.players[game.playerId],
      game.playerSyncMeta[game.playerId],
      game.localMotionPrediction,
      game.trackLengthMeters,
      game.raceStopped,
      Date.now()
    );
    if (!localPlayer) {
      return;
    }

    const speedFactor = Math.min(1.0, localPlayer.speedMps / 110);
    const targetX = laneToX(localPlayer.laneIndex);
    const targetZ = -localPlayer.positionMeters * TRACK_Z_SCALE;

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

export function RaceScene() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 4.5, 12], fov: 58 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#040913"]} />
      <fog attach="fog" args={["#040913", 18, 220]} />
      <ambientLight intensity={0.36} />
      <directionalLight position={[5, 12, 6]} intensity={1.25} castShadow />
      <pointLight position={[0, 8, -40]} color="#28f6ff" intensity={25} distance={120} />
      <pointLight position={[0, 6, -120]} color="#ff5468" intensity={16} distance={120} />

      <NeonTrack />
      <SideProgressMarkers />
      <FinishGate />
      <CarsLayer />
      <CameraRig />
      <Sparkles count={70} color="#9dc7ff" scale={[90, 25, 280]} size={2.4} speed={0.45} />

      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={1.28} luminanceThreshold={0.12} luminanceSmoothing={0.6} />
        <Noise opacity={0.035} />
        <Vignette eskil={false} offset={0.12} darkness={0.86} />
      </EffectComposer>
    </Canvas>
  );
}
