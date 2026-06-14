const FALLBACK_SOLO_LANE_SPACING_METERS = 6;

export function getSoloLaneOffsets(totalRacers: number) {
  const safeTotal = Math.max(1, Math.trunc(totalRacers));
  if (safeTotal === 1) {
    return [0];
  }
  if (safeTotal === 2) {
    return [-4, 4];
  }
  if (safeTotal === 3) {
    return [-6, 0, 6];
  }
  if (safeTotal === 4) {
    return [-9, -3, 3, 9];
  }

  const center = (safeTotal - 1) / 2;
  return Array.from({ length: safeTotal }, (_, index) => (index - center) * FALLBACK_SOLO_LANE_SPACING_METERS);
}

export function getSoloLaneX(laneIndex: number, totalRacers: number) {
  const offsets = getSoloLaneOffsets(totalRacers);
  const safeLaneIndex = Number.isFinite(laneIndex)
    ? Math.max(0, Math.min(offsets.length - 1, Math.trunc(laneIndex)))
    : 0;
  return offsets[safeLaneIndex] ?? 0;
}

export function getSoloLocalCenteredLaneOffsets(totalRacers: number) {
  const safeTotal = Math.max(1, Math.trunc(totalRacers));
  if (safeTotal === 1) {
    return [0];
  }
  if (safeTotal === 2) {
    return [0, 6];
  }
  if (safeTotal === 3) {
    return [-6, 0, 6];
  }
  if (safeTotal === 4) {
    return [-9, -3, 0, 6];
  }

  const leftCount = Math.floor((safeTotal - 1) / 2);
  return Array.from({ length: safeTotal }, (_, index) => (index - leftCount) * FALLBACK_SOLO_LANE_SPACING_METERS);
}

export function getSoloLocalCenteredLaneX(laneIndex: number, totalRacers: number, localLaneIndex: number) {
  const safeTotal = Math.max(1, Math.trunc(totalRacers));
  const safeLaneIndex = Number.isFinite(laneIndex)
    ? Math.max(0, Math.min(safeTotal - 1, Math.trunc(laneIndex)))
    : 0;
  const safeLocalLaneIndex = Number.isFinite(localLaneIndex)
    ? Math.max(0, Math.min(safeTotal - 1, Math.trunc(localLaneIndex)))
    : 0;

  if (safeLaneIndex === safeLocalLaneIndex) {
    return 0;
  }

  const centeredOffsets = getSoloLocalCenteredLaneOffsets(safeTotal);
  const otherLaneIndices = Array.from({ length: safeTotal }, (_, index) => index)
    .filter((index) => index !== safeLocalLaneIndex);
  const otherOffsets = centeredOffsets.filter((offset) => offset !== 0);
  const otherIndex = otherLaneIndices.indexOf(safeLaneIndex);
  return otherOffsets[Math.max(0, otherIndex)] ?? getSoloLaneX(safeLaneIndex, safeTotal);
}
