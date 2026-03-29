package com.asphalt8.backend.game.dto;

public record QuestionMessage(
    String roomId,
    String targetPlayerId,
    String questionId,
    String prompt,
    int difficulty,
    int timeLimitMs,
    long expiresAtMs,
    boolean highwayChallenge
) {
}
