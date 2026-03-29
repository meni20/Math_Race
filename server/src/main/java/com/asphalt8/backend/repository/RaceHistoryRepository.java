package com.asphalt8.backend.repository;

import com.asphalt8.backend.entity.RaceHistory;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RaceHistoryRepository extends JpaRepository<RaceHistory, String> {
}
