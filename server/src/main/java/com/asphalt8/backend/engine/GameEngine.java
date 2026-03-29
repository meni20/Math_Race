package com.asphalt8.backend.engine;

import com.asphalt8.backend.service.GameStateService;
import com.asphalt8.backend.service.SessionBindingService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class GameEngine {

    private final GameStateService gameStateService;
    private final SessionBindingService sessionBindingService;
    private final SimpMessagingTemplate messagingTemplate;
    private volatile long lastTickAtMs;

    public GameEngine(
        GameStateService gameStateService,
        SessionBindingService sessionBindingService,
        SimpMessagingTemplate messagingTemplate,
        @Value("${game.tick-rate-ms:50}") int tickRateMs
    ) {
        if (tickRateMs <= 0) {
            throw new IllegalArgumentException("game.tick-rate-ms must be > 0");
        }
        this.gameStateService = gameStateService;
        this.sessionBindingService = sessionBindingService;
        this.messagingTemplate = messagingTemplate;
        this.lastTickAtMs = System.currentTimeMillis();
    }

    @Scheduled(fixedRateString = "${game.tick-rate-ms:50}")
    public void tick() {
        long now = System.currentTimeMillis();
        long elapsedMs = Math.max(1L, now - lastTickAtMs);
        lastTickAtMs = now;
        double deltaSeconds = Math.max(0.01, Math.min(0.25, elapsedMs / 1000.0));

        GameStateService.TickDispatch tickDispatch = gameStateService.tickAndBuildUpdates(deltaSeconds);
        tickDispatch
            .stateUpdates()
            .forEach(update ->
                sessionBindingService
                    .resolvePrincipalsByRoom(update.roomId())
                    .forEach(principalName ->
                        messagingTemplate.convertAndSendToUser(principalName, "/queue/game.state", update)
                    )
            );
        tickDispatch
            .questionUpdates()
            .forEach(question ->
                sessionBindingService
                    .resolvePrincipal(question.roomId(), question.targetPlayerId())
                    .ifPresent(principalName ->
                        messagingTemplate.convertAndSendToUser(principalName, "/queue/game.question", question)
                    )
            );
    }
}
