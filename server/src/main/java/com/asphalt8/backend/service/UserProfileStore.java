package com.asphalt8.backend.service;

import com.asphalt8.backend.entity.UserProfile;
import java.util.Optional;

public interface UserProfileStore {

    Optional<UserProfile> findById(String playerId);

    UserProfile save(UserProfile profile);
}
