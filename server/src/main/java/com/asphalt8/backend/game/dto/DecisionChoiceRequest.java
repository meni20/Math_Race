package com.asphalt8.backend.game.dto;

public record DecisionChoiceRequest(
    String roomId,
    String playerId,
    String eventId,
    String choice
) {
}
