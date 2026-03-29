package com.asphalt8.backend.service;

import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

@Service
public class InboundRateLimiter {

    private final ConcurrentHashMap<String, Long> lastEventMsByKey = new ConcurrentHashMap<>();

    public boolean allow(String principalName, String action, long minIntervalMs) {
        long now = System.currentTimeMillis();
        String key = principalName + "|" + action;
        Long previous = lastEventMsByKey.putIfAbsent(key, now);
        if (previous == null) {
            return true;
        }
        if (now - previous < minIntervalMs) {
            return false;
        }
        lastEventMsByKey.put(key, now);
        return true;
    }

    public void clearPrincipal(String principalName) {
        String prefix = principalName + "|";
        lastEventMsByKey.keySet().removeIf(key -> key.startsWith(prefix));
    }
}
