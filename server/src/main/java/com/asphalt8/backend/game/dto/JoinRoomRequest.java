package com.asphalt8.backend.game.dto;

public record JoinRoomRequest(
    String roomId,
    String playerId,
    String displayName,
    String carId
) {
    public JoinRoomRequest(String roomId, String playerId, String displayName) {
        this(roomId, playerId, displayName, null);
    }
}
