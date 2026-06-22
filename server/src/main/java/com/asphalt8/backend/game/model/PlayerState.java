package com.asphalt8.backend.game.model;

import java.util.HashMap;
import java.util.Map;

public class PlayerState {

    private final String playerId;
    private String displayName;
    private String carId;
    private int laneIndex;
    private double positionMeters;
    private double speedMps;
    private double baseSpeedMps;
    private double boostSpeedMps;
    private long boostUntilMs;
    private int lap;
    private boolean finished;
    private int correctStreak;
    private PendingQuestion pendingQuestion;
    private DecisionPoint pendingDecisionPoint;
    private long decisionCooldownUntilMs;
    private boolean highwayChallengeActive;
    private String racePhase;
    private long lastSeenAtMs;
    private String routeMode;
    private final HashMap<String, Integer> routeStats;
    private double maxSpeedMps;

    public PlayerState(String playerId, String displayName, int laneIndex, double baseSpeedMps) {
        this(playerId, displayName, laneIndex, baseSpeedMps, "bmw-m3");
    }

    public PlayerState(String playerId, String displayName, int laneIndex, double baseSpeedMps, String carId) {
        this.playerId = playerId;
        this.displayName = displayName;
        this.carId = carId;
        this.laneIndex = laneIndex;
        this.baseSpeedMps = baseSpeedMps;
        this.speedMps = baseSpeedMps;
        this.boostSpeedMps = baseSpeedMps;
        this.boostUntilMs = 0L;
        this.positionMeters = 0D;
        this.lap = 0;
        this.finished = false;
        this.correctStreak = 0;
        this.decisionCooldownUntilMs = 0L;
        this.highwayChallengeActive = false;
        this.racePhase = "lobby";
        this.lastSeenAtMs = System.currentTimeMillis();
        this.routeMode = "NORMAL";
        this.routeStats = new HashMap<>();
        this.maxSpeedMps = baseSpeedMps;
    }

    public String getPlayerId() {
        return playerId;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getCarId() {
        return carId;
    }

    public void setCarId(String carId) {
        this.carId = carId;
    }

    public int getLaneIndex() {
        return laneIndex;
    }

    public void setLaneIndex(int laneIndex) {
        this.laneIndex = laneIndex;
    }

    public double getPositionMeters() {
        return positionMeters;
    }

    public void setPositionMeters(double positionMeters) {
        this.positionMeters = positionMeters;
    }

    public double getSpeedMps() {
        return speedMps;
    }

    public void setSpeedMps(double speedMps) {
        this.speedMps = speedMps;
        this.maxSpeedMps = Math.max(this.maxSpeedMps, speedMps);
    }

    public double getBaseSpeedMps() {
        return baseSpeedMps;
    }

    public void setBaseSpeedMps(double baseSpeedMps) {
        this.baseSpeedMps = baseSpeedMps;
    }

    public double getBoostSpeedMps() {
        return boostSpeedMps;
    }

    public void setBoostSpeedMps(double boostSpeedMps) {
        this.boostSpeedMps = boostSpeedMps;
    }

    public long getBoostUntilMs() {
        return boostUntilMs;
    }

    public void setBoostUntilMs(long boostUntilMs) {
        this.boostUntilMs = boostUntilMs;
    }

    public int getLap() {
        return lap;
    }

    public void setLap(int lap) {
        this.lap = lap;
    }

    public boolean isFinished() {
        return finished;
    }

    public void setFinished(boolean finished) {
        this.finished = finished;
    }

    public int getCorrectStreak() {
        return correctStreak;
    }

    public void setCorrectStreak(int correctStreak) {
        this.correctStreak = correctStreak;
    }

    public PendingQuestion getPendingQuestion() {
        return pendingQuestion;
    }

    public void setPendingQuestion(PendingQuestion pendingQuestion) {
        this.pendingQuestion = pendingQuestion;
    }

    public DecisionPoint getPendingDecisionPoint() {
        return pendingDecisionPoint;
    }

    public void setPendingDecisionPoint(DecisionPoint pendingDecisionPoint) {
        this.pendingDecisionPoint = pendingDecisionPoint;
    }

    public long getDecisionCooldownUntilMs() {
        return decisionCooldownUntilMs;
    }

    public void setDecisionCooldownUntilMs(long decisionCooldownUntilMs) {
        this.decisionCooldownUntilMs = decisionCooldownUntilMs;
    }

    public boolean isHighwayChallengeActive() {
        return highwayChallengeActive;
    }

    public void setHighwayChallengeActive(boolean highwayChallengeActive) {
        this.highwayChallengeActive = highwayChallengeActive;
    }

    public String getRacePhase() {
        return racePhase;
    }

    public void setRacePhase(String racePhase) {
        this.racePhase = racePhase;
    }

    public long getLastSeenAtMs() {
        return lastSeenAtMs;
    }

    public void setLastSeenAtMs(long lastSeenAtMs) {
        this.lastSeenAtMs = lastSeenAtMs;
    }

    public String getRouteMode() {
        return routeMode;
    }

    public void setRouteMode(String routeMode) {
        this.routeMode = routeMode == null || routeMode.isBlank() ? "NORMAL" : routeMode;
    }

    public Map<String, Integer> getRouteStats() {
        return Map.copyOf(routeStats);
    }

    public void recordRoute(String route) {
        String normalized = route == null || route.isBlank() ? "NORMAL" : route;
        routeStats.merge(normalized, 1, Integer::sum);
        routeMode = normalized;
    }

    public double getMaxSpeedMps() {
        return maxSpeedMps;
    }

    public void resetRaceTelemetry() {
        routeMode = "NORMAL";
        routeStats.clear();
        maxSpeedMps = Math.max(0D, speedMps);
    }
}
