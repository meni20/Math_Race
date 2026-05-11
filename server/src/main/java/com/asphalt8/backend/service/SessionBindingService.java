package com.asphalt8.backend.service;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

@Service
public class SessionBindingService {

    private final ConcurrentHashMap<String, SessionBinding> bindingsByPrincipal = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> principalByPlayerKey = new ConcurrentHashMap<>();

    public synchronized BindResult bind(String principalName, String websocketSessionId, String roomId, String playerId) {
        String playerKey = key(roomId, playerId);
        SessionBinding previousBinding = bindingsByPrincipal.get(principalName);
        if (previousBinding != null) {
            String previousKey = key(previousBinding.roomId(), previousBinding.playerId());
            if (!previousKey.equals(playerKey)) {
                principalByPlayerKey.remove(previousKey, principalName);
            }
        }

        String existingPrincipal = principalByPlayerKey.get(playerKey);
        if (existingPrincipal != null && !existingPrincipal.equals(principalName)) {
            if (previousBinding != null) {
                principalByPlayerKey.put(key(previousBinding.roomId(), previousBinding.playerId()), principalName);
            }
            return BindResult.rejected(
                "BIND_REJECTED",
                "Player is already bound to another active session.",
                existingPrincipal
            );
        }

        SessionBinding binding = new SessionBinding(principalName, websocketSessionId, roomId, playerId, System.currentTimeMillis());
        principalByPlayerKey.put(playerKey, principalName);
        bindingsByPrincipal.put(principalName, binding);
        return BindResult.accepted(binding);
    }

    public boolean isAuthorized(String principalName, String websocketSessionId, String roomId, String playerId) {
        SessionBinding binding = bindingsByPrincipal.get(principalName);
        if (binding == null) {
            return false;
        }
        return binding.websocketSessionId().equals(websocketSessionId)
            && binding.roomId().equals(roomId)
            && binding.playerId().equals(playerId);
    }

    public Optional<String> resolvePrincipal(String roomId, String playerId) {
        return Optional.ofNullable(principalByPlayerKey.get(key(roomId, playerId)));
    }

    public List<String> resolvePrincipalsByRoom(String roomId) {
        return bindingsByPrincipal
            .values()
            .stream()
            .filter(binding -> binding.roomId().equals(roomId))
            .map(SessionBinding::principalName)
            .distinct()
            .toList();
    }

    public Optional<SessionBinding> unregister(String principalName, String websocketSessionId) {
        SessionBinding current = bindingsByPrincipal.get(principalName);
        if (current == null || !current.websocketSessionId().equals(websocketSessionId)) {
            return Optional.empty();
        }
        SessionBinding removed = bindingsByPrincipal.remove(principalName);
        if (removed == null) {
            return Optional.empty();
        }

        principalByPlayerKey.remove(key(removed.roomId(), removed.playerId()), principalName);
        return Optional.of(removed);
    }

    private static String key(String roomId, String playerId) {
        return roomId + "|" + playerId;
    }

    public record SessionBinding(
        String principalName,
        String websocketSessionId,
        String roomId,
        String playerId,
        long boundAtMs
    ) {
    }

    public record BindResult(
        boolean accepted,
        SessionBinding binding,
        String errorCode,
        String errorMessage,
        String conflictingPrincipal
    ) {
        public static BindResult accepted(SessionBinding binding) {
            return new BindResult(true, binding, null, null, null);
        }

        public static BindResult rejected(String errorCode, String errorMessage, String conflictingPrincipal) {
            return new BindResult(false, null, errorCode, errorMessage, conflictingPrincipal);
        }
    }
}
