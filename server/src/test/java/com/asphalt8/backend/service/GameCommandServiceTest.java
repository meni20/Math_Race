package com.asphalt8.backend.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.asphalt8.backend.game.dto.GameStateUpdateMessage;
import com.asphalt8.backend.game.dto.JoinRoomRequest;
import com.asphalt8.backend.game.dto.PlayerSnapshot;
import com.asphalt8.backend.game.dto.RoomJoinedMessage;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.messaging.simp.SimpMessagingTemplate;

public class GameCommandServiceTest {

    private GameStateService gameStateService;
    private SessionBindingService sessionBindingService;
    private InboundRateLimiter inboundRateLimiter;
    private SimpMessagingTemplate messagingTemplate;
    private GameCommandService gameCommandService;

    @BeforeEach
    public void setUp() {
        gameStateService = Mockito.mock(GameStateService.class);
        sessionBindingService = Mockito.mock(SessionBindingService.class);
        inboundRateLimiter = Mockito.mock(InboundRateLimiter.class);
        messagingTemplate = Mockito.mock(SimpMessagingTemplate.class);

        gameCommandService = new GameCommandService(
            gameStateService,
            sessionBindingService,
            inboundRateLimiter,
            messagingTemplate
        );
    }

    @Test
    public void handleJoinBroadcastsImmediateStateToEveryoneInRoom() {
        JoinRoomRequest request = new JoinRoomRequest("arena-1", "p-1", "Player One");
        RoomJoinedMessage joinedMessage = new RoomJoinedMessage("arena-1", "p-1", "Player One", 3000.0, 1, 42.0);
        GameStateUpdateMessage initialState = new GameStateUpdateMessage(
            "arena-1",
            1234L,
            0L,
            1200L,
            false,
            0L,
            null,
            List.of(new PlayerSnapshot("p-1", "Player One", 0, 0.0, 42.0, 0, false))
        );
        GameStateService.JoinOutcome joinOutcome = new GameStateService.JoinOutcome(
            joinedMessage,
            List.of(),
            false,
            initialState
        );

        when(inboundRateLimiter.allow("principal-1", "join", 500L)).thenReturn(true);
        when(sessionBindingService.bind("principal-1", "arena-1", "p-1")).thenReturn(
            SessionBindingService.BindResult.accepted(
                new SessionBindingService.SessionBinding("principal-1", "arena-1", "p-1", System.currentTimeMillis())
            )
        );
        when(sessionBindingService.resolvePrincipalsByRoom("arena-1")).thenReturn(List.of("principal-1", "principal-2"));
        when(gameStateService.joinRoom(any(JoinRoomRequest.class))).thenReturn(joinOutcome);

        gameCommandService.handleJoin(request, "principal-1");

        verify(messagingTemplate).convertAndSendToUser("principal-1", "/queue/game.joined", joinedMessage);
        verify(messagingTemplate).convertAndSendToUser("principal-1", "/queue/game.state", initialState);
        verify(messagingTemplate).convertAndSendToUser("principal-2", "/queue/game.state", initialState);
        verify(gameStateService).joinRoom(eq(new JoinRoomRequest("arena-1", "p-1", "Player One")));
    }
}
