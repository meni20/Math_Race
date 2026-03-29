package com.asphalt8.backend.game.model;

import java.util.concurrent.ConcurrentHashMap;

public class GameRoomState {

    private final String roomId;
    private final double trackLengthMeters;
    private final int totalLaps;
    private final long createdAtMs;
    private final Object lock;
    private final ConcurrentHashMap<String, PlayerState> players;
    private long tick;
    private boolean resultPersisted;
    private long persistRetryAtMs;
    private boolean raceStopped;
    private long raceStartedAtMs;
    private long raceStoppedAtMs;
    private long lastInteractionAtMs;
    private String winnerPlayerId;

    public GameRoomState(String roomId, double trackLengthMeters, int totalLaps) {
        this.roomId = roomId;
        this.trackLengthMeters = trackLengthMeters;
        this.totalLaps = totalLaps;
        this.createdAtMs = System.currentTimeMillis();
        this.lock = new Object();
        this.players = new ConcurrentHashMap<>();
        this.tick = 0L;
        this.resultPersisted = false;
        this.persistRetryAtMs = 0L;
        this.raceStopped = false;
        this.raceStartedAtMs = this.createdAtMs;
        this.raceStoppedAtMs = 0L;
        this.lastInteractionAtMs = this.createdAtMs;
        this.winnerPlayerId = null;
    }

    public String getRoomId() {
        return roomId;
    }

    public double getTrackLengthMeters() {
        return trackLengthMeters;
    }

    public int getTotalLaps() {
        return totalLaps;
    }

    public long getCreatedAtMs() {
        return createdAtMs;
    }

    public Object getLock() {
        return lock;
    }

    public ConcurrentHashMap<String, PlayerState> getPlayers() {
        return players;
    }

    public long getTick() {
        return tick;
    }

    public void setTick(long tick) {
        this.tick = tick;
    }

    public boolean isResultPersisted() {
        return resultPersisted;
    }

    public void setResultPersisted(boolean resultPersisted) {
        this.resultPersisted = resultPersisted;
    }

    public long getPersistRetryAtMs() {
        return persistRetryAtMs;
    }

    public void setPersistRetryAtMs(long persistRetryAtMs) {
        this.persistRetryAtMs = persistRetryAtMs;
    }

    public boolean isRaceStopped() {
        return raceStopped;
    }

    public void setRaceStopped(boolean raceStopped) {
        this.raceStopped = raceStopped;
    }

    public long getRaceStartedAtMs() {
        return raceStartedAtMs;
    }

    public void setRaceStartedAtMs(long raceStartedAtMs) {
        this.raceStartedAtMs = raceStartedAtMs;
    }

    public long getRaceStoppedAtMs() {
        return raceStoppedAtMs;
    }

    public void setRaceStoppedAtMs(long raceStoppedAtMs) {
        this.raceStoppedAtMs = raceStoppedAtMs;
    }

    public long getLastInteractionAtMs() {
        return lastInteractionAtMs;
    }

    public void setLastInteractionAtMs(long lastInteractionAtMs) {
        this.lastInteractionAtMs = lastInteractionAtMs;
    }

    public String getWinnerPlayerId() {
        return winnerPlayerId;
    }

    public void setWinnerPlayerId(String winnerPlayerId) {
        this.winnerPlayerId = winnerPlayerId;
    }
}
