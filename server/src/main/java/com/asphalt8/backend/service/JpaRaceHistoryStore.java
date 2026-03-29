package com.asphalt8.backend.service;

import com.asphalt8.backend.entity.RaceHistory;
import com.asphalt8.backend.repository.RaceHistoryRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

@Service
@Profile("db")
public class JpaRaceHistoryStore implements RaceHistoryStore {

    private final RaceHistoryRepository raceHistoryRepository;

    public JpaRaceHistoryStore(RaceHistoryRepository raceHistoryRepository) {
        this.raceHistoryRepository = raceHistoryRepository;
    }

    @Override
    public RaceHistory save(RaceHistory history) {
        return raceHistoryRepository.save(history);
    }
}
