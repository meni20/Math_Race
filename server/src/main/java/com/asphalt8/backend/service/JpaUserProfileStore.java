package com.asphalt8.backend.service;

import com.asphalt8.backend.entity.UserProfile;
import com.asphalt8.backend.repository.UserProfileRepository;
import java.util.Optional;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

@Service
@Profile("db")
public class JpaUserProfileStore implements UserProfileStore {

    private final UserProfileRepository userProfileRepository;

    public JpaUserProfileStore(UserProfileRepository userProfileRepository) {
        this.userProfileRepository = userProfileRepository;
    }

    @Override
    public Optional<UserProfile> findById(String playerId) {
        return userProfileRepository.findById(playerId);
    }

    @Override
    public UserProfile save(UserProfile profile) {
        return userProfileRepository.save(profile);
    }
}
