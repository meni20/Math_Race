package com.asphalt8.backend.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "race_history")
public class RaceHistory {

    @Id
    @Column(length = 64, nullable = false)
    private String id;

    @Column(length = 64, nullable = false)
    private String roomId;

    @Column(length = 64, nullable = false)
    private String winnerPlayerId;

    @Column(nullable = false)
    private Integer totalPlayers;

    @Column(nullable = false)
    private Integer totalLaps;

    @Column(nullable = false)
    private Double trackLengthMeters;

    @Column(nullable = false)
    private Instant finishedAt;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String resultPayloadJson;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getRoomId() {
        return roomId;
    }

    public void setRoomId(String roomId) {
        this.roomId = roomId;
    }

    public String getWinnerPlayerId() {
        return winnerPlayerId;
    }

    public void setWinnerPlayerId(String winnerPlayerId) {
        this.winnerPlayerId = winnerPlayerId;
    }

    public Integer getTotalPlayers() {
        return totalPlayers;
    }

    public void setTotalPlayers(Integer totalPlayers) {
        this.totalPlayers = totalPlayers;
    }

    public Integer getTotalLaps() {
        return totalLaps;
    }

    public void setTotalLaps(Integer totalLaps) {
        this.totalLaps = totalLaps;
    }

    public Double getTrackLengthMeters() {
        return trackLengthMeters;
    }

    public void setTrackLengthMeters(Double trackLengthMeters) {
        this.trackLengthMeters = trackLengthMeters;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }

    public void setFinishedAt(Instant finishedAt) {
        this.finishedAt = finishedAt;
    }

    public String getResultPayloadJson() {
        return resultPayloadJson;
    }

    public void setResultPayloadJson(String resultPayloadJson) {
        this.resultPayloadJson = resultPayloadJson;
    }

    @PrePersist
    public void onCreate() {
        if (id == null || id.isBlank()) {
            id = UUID.randomUUID().toString();
        }
        if (finishedAt == null) {
            finishedAt = Instant.now();
        }
    }
}
