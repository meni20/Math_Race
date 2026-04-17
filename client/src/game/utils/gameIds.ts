const MAX_ID_LENGTH = 64;

function normalizeId(raw: string) {
  const sanitized = raw
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-{2,}/g, "-");
  return sanitized.slice(0, MAX_ID_LENGTH);
}

export function normalizeRoomId(roomId: string) {
  return normalizeId(roomId);
}

export function normalizePlayerId(playerId: string) {
  return normalizeId(playerId);
}

export function isSoloRoomId(roomId: string) {
  return roomId.startsWith("solo-");
}
