package com.asphalt8.backend.game.model;

import java.util.List;

public record DecisionPoint(
    String eventId,
    String prompt,
    List<String> options,
    long expiresAtMs
) {
}
