const MAX_ID_LENGTH = 64;
const MAX_DISPLAY_NAME_LENGTH = 64;

function buildGeneratedId(prefix: string) {
  return `${prefix}${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeId(raw: string | null | undefined, generatedPrefix: string, allowGenerated: boolean) {
  if (!raw || !raw.trim()) {
    if (!allowGenerated) {
      throw new Error("Missing required id");
    }
    return buildGeneratedId(generatedPrefix);
  }

  let sanitized = raw.trim().replace(/[^A-Za-z0-9_-]/g, "-").replace(/-{2,}/g, "-");
  if (!sanitized) {
    if (!allowGenerated) {
      throw new Error("Invalid id");
    }
    return buildGeneratedId(generatedPrefix);
  }

  if (sanitized.length > MAX_ID_LENGTH) {
    sanitized = sanitized.slice(0, MAX_ID_LENGTH);
  }

  return sanitized;
}

export function normalizeRoomId(raw: string | null | undefined, allowGenerated: boolean) {
  return normalizeId(raw, "room-", allowGenerated);
}

export function normalizePlayerId(raw: string | null | undefined, allowGenerated: boolean) {
  return normalizeId(raw, "p-", allowGenerated);
}

export function normalizeDisplayName(raw: string | null | undefined, fallbackPlayerId: string) {
  const suffix = fallbackPlayerId.slice(Math.max(0, fallbackPlayerId.length - 4));
  const fallback = `Racer-${suffix}`;
  if (!raw || !raw.trim()) {
    return fallback;
  }

  let sanitized = raw.trim().replace(/\s{2,}/g, " ").replace(/[^A-Za-z0-9 _'\-.]/g, "");
  if (!sanitized) {
    return fallback;
  }

  if (sanitized.length > MAX_DISPLAY_NAME_LENGTH) {
    sanitized = sanitized.slice(0, MAX_DISPLAY_NAME_LENGTH);
  }

  return sanitized;
}
