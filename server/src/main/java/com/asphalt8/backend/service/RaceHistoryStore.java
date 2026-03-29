package com.asphalt8.backend.service;

import com.asphalt8.backend.entity.RaceHistory;

public interface RaceHistoryStore {

    RaceHistory save(RaceHistory history);
}
