package com.asphalt8.backend.controller;

import com.asphalt8.backend.service.GameStateService;
import com.asphalt8.backend.service.InboundRateLimiter;
import com.asphalt8.backend.service.SessionBindingService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

@Component
public class WebSocketSessionListener {

    private static final Logger log = LoggerFactory.getLogger(WebSocketSessionListener.class);

    private final SessionBindingService sessionBindingService;
    private final InboundRateLimiter inboundRateLimiter;
    private final GameStateService gameStateService;

    public WebSocketSessionListener(
        SessionBindingService sessionBindingService,
        InboundRateLimiter inboundRateLimiter,
        GameStateService gameStateService
    ) {
        this.sessionBindingService = sessionBindingService;
        this.inboundRateLimiter = inboundRateLimiter;
        this.gameStateService = gameStateService;
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        if (event.getUser() == null) {
            return;
        }
        String principalName = event.getUser().getName();
        log.info("Disconnect event for principal={}", principalName);
        inboundRateLimiter.clearPrincipal(principalName);
        sessionBindingService
            .unregister(principalName)
            .ifPresent(binding -> gameStateService.removePlayerFromRoom(binding.roomId(), binding.playerId()));
    }
}
