package com.asphalt8.backend.game.dto;

import java.util.List;

public record QuestionMessage(
    String roomId,
    String targetPlayerId,
    String questionId,
    String prompt,
    List<String> choices,
    int difficulty,
    int timeLimitMs,
    long expiresAtMs,
    boolean highwayChallenge
) {
}
