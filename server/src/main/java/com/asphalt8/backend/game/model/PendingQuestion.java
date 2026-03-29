package com.asphalt8.backend.game.model;

public class PendingQuestion {

    private final GeneratedQuestion question;
    private final long expiresAtMs;
    private final boolean fromHighwayChallenge;

    public PendingQuestion(GeneratedQuestion question, long expiresAtMs, boolean fromHighwayChallenge) {
        this.question = question;
        this.expiresAtMs = expiresAtMs;
        this.fromHighwayChallenge = fromHighwayChallenge;
    }

    public GeneratedQuestion getQuestion() {
        return question;
    }

    public long getExpiresAtMs() {
        return expiresAtMs;
    }

    public boolean isFromHighwayChallenge() {
        return fromHighwayChallenge;
    }
}
