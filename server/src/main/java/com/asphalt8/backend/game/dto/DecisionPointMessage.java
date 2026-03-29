package com.asphalt8.backend.game.dto;

import java.util.List;

public record DecisionPointMessage(
    String roomId,
    String targetPlayerId,
    String eventId,
    String prompt,
    List<String> options,
    long expiresAtMs
) {
}
