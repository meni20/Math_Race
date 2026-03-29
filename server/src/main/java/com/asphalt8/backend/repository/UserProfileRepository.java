package com.asphalt8.backend.repository;

import com.asphalt8.backend.entity.UserProfile;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserProfileRepository extends JpaRepository<UserProfile, String> {
    Optional<UserProfile> findByDisplayName(String displayName);
}
