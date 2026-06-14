package com.asphalt8.backend.game.model;

import java.util.List;

public record GeneratedQuestion(
    String questionId,
    String prompt,
    String correctAnswer,
    List<String> choices,
    int difficulty,
    int timeLimitMs,
    double boostMultiplier
) {
}
