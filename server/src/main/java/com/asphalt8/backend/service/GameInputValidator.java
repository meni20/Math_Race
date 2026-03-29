package com.asphalt8.backend.service;

import java.util.UUID;

public final class GameInputValidator {

    private static final int MAX_ID_LENGTH = 64;
    private static final int MAX_DISPLAY_NAME_LENGTH = 64;

    private GameInputValidator() {
    }

    public static String normalizeRoomId(String roomId, boolean allowGenerated) {
        return normalizeId(roomId, "room-", allowGenerated);
    }

    public static String normalizePlayerId(String playerId, boolean allowGenerated) {
        return normalizeId(playerId, "p-", allowGenerated);
    }

    public static String normalizeDisplayName(String displayName, String fallbackPlayerId) {
        String fallback = "Racer-" + fallbackPlayerId.substring(Math.max(0, fallbackPlayerId.length() - 4));
        if (displayName == null || displayName.isBlank()) {
            return fallback;
        }

        String sanitized = displayName
            .trim()
            .replaceAll("\\s{2,}", " ")
            .replaceAll("[^A-Za-z0-9 _'\\-.]", "");
        if (sanitized.isBlank()) {
            return fallback;
        }

        if (sanitized.length() > MAX_DISPLAY_NAME_LENGTH) {
            return sanitized.substring(0, MAX_DISPLAY_NAME_LENGTH);
        }
        return sanitized;
    }

    private static String normalizeId(String raw, String generatedPrefix, boolean allowGenerated) {
        if (raw == null || raw.isBlank()) {
            if (!allowGenerated) {
                throw new IllegalArgumentException("Missing required id");
            }
            return generatedPrefix + UUID.randomUUID().toString().substring(0, 8);
        }

        String sanitized = raw
            .trim()
            .replaceAll("[^A-Za-z0-9_-]", "-")
            .replaceAll("-{2,}", "-");
        if (sanitized.isBlank()) {
            if (!allowGenerated) {
                throw new IllegalArgumentException("Invalid id");
            }
            return generatedPrefix + UUID.randomUUID().toString().substring(0, 8);
        }

        if (sanitized.length() > MAX_ID_LENGTH) {
            sanitized = sanitized.substring(0, MAX_ID_LENGTH);
        }
        return sanitized;
    }
}
