package com.asphalt8.backend.service;

import com.asphalt8.backend.entity.UserProfile;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

@Service
@Profile("!db")
public class InMemoryUserProfileStore implements UserProfileStore {

    private final ConcurrentHashMap<String, UserProfile> profiles = new ConcurrentHashMap<>();

    @Override
    public Optional<UserProfile> findById(String playerId) {
        return Optional.ofNullable(profiles.get(playerId))
            .map(InMemoryUserProfileStore::copyProfile);
    }

    @Override
    public UserProfile save(UserProfile profile) {
        UserProfile stored = copyProfile(profile);
        if (stored.getCreatedAt() == null) {
            stored.setCreatedAt(Instant.now());
        }
        profiles.put(stored.getId(), stored);
        return copyProfile(stored);
    }

    private static UserProfile copyProfile(UserProfile source) {
        UserProfile copy = new UserProfile();
        copy.setId(source.getId());
        copy.setDisplayName(source.getDisplayName());
        copy.setCreatedAt(source.getCreatedAt());
        return copy;
    }
}
