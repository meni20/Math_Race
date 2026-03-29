package com.asphalt8.backend.game.dto;

public record AnswerFeedbackMessage(
    String roomId,
    String targetPlayerId,
    boolean accepted,
    boolean correct
) {
}
