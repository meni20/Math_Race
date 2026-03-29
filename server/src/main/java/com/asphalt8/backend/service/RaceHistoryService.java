package com.asphalt8.backend.service;

import com.asphalt8.backend.entity.RaceHistory;
import com.asphalt8.backend.game.model.GameRoomState;
import com.asphalt8.backend.game.model.PlayerState;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class RaceHistoryService {

    private final RaceHistoryStore raceHistoryStore;
    private final ObjectMapper objectMapper;

    public RaceHistoryService(RaceHistoryStore raceHistoryStore, ObjectMapper objectMapper) {
        this.raceHistoryStore = raceHistoryStore;
        this.objectMapper = objectMapper;
    }

    public void recordRoomResult(GameRoomState room, PlayerState winner) {
        RaceHistory history = new RaceHistory();
        history.setRoomId(room.getRoomId());
        history.setWinnerPlayerId(winner.getPlayerId());
        history.setTrackLengthMeters(room.getTrackLengthMeters());
        history.setTotalLaps(room.getTotalLaps());
        history.setTotalPlayers(room.getPlayers().size());
        history.setFinishedAt(Instant.now());
        history.setResultPayloadJson(buildPayload(room));
        raceHistoryStore.save(history);
    }

    private String buildPayload(GameRoomState room) {
        List<Map<String, Object>> standings = room
            .getPlayers()
            .values()
            .stream()
            .sorted((a, b) -> {
                int lapDiff = Integer.compare(b.getLap(), a.getLap());
                if (lapDiff != 0) {
                    return lapDiff;
                }
                return Double.compare(b.getPositionMeters(), a.getPositionMeters());
            })
            .map(player -> {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("playerId", player.getPlayerId());
                row.put("displayName", player.getDisplayName());
                row.put("lap", player.getLap());
                row.put("positionMeters", player.getPositionMeters());
                row.put("speedMps", player.getSpeedMps());
                row.put("finished", player.isFinished());
                return row;
            })
            .toList();

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("roomId", room.getRoomId());
        payload.put("tick", room.getTick());
        payload.put("createdAtMs", room.getCreatedAtMs());
        payload.put("standings", standings);

        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException ex) {
            return "{\"error\":\"serialization_failed\"}";
        }
    }
}
