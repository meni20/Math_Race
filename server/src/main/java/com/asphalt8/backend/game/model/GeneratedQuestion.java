package com.asphalt8.backend.game.model;

public record GeneratedQuestion(
    String questionId,
    String prompt,
    String correctAnswer,
    int difficulty,
    int timeLimitMs,
    double boostMultiplier
) {
}
