package com.asphalt8.backend.service;

import com.asphalt8.backend.entity.RaceHistory;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

@Service
@Profile("!db")
public class InMemoryRaceHistoryStore implements RaceHistoryStore {

    private final ConcurrentHashMap<String, RaceHistory> historyById = new ConcurrentHashMap<>();

    @Override
    public RaceHistory save(RaceHistory history) {
        if (history.getId() == null || history.getId().isBlank()) {
            history.setId(UUID.randomUUID().toString());
        }
        if (history.getFinishedAt() == null) {
            history.setFinishedAt(Instant.now());
        }
        historyById.put(history.getId(), history);
        return history;
    }
}
