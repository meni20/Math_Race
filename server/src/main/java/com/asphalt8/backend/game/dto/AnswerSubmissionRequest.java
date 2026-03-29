package com.asphalt8.backend.game.dto;

public record AnswerSubmissionRequest(
    String roomId,
    String playerId,
    String questionId,
    String answer
) {
}
