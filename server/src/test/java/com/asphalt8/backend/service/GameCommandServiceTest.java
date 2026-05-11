package com.asphalt8.backend.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.asphalt8.backend.game.dto.GameStateUpdateMessage;
import com.asphalt8.backend.game.dto.JoinRoomRequest;
import com.asphalt8.backend.game.dto.PlayerSnapshot;
import com.asphalt8.backend.game.dto.RoomJoinedMessage;
import com.asphalt8.backend.game.dto.RoomSettings;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
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
        RoomSettings roomSettings = new RoomSettings("Arena 1 setup", 4, 180, 8);
        RoomJoinedMessage joinedMessage = new RoomJoinedMessage("arena-1", "p-1", "Player One", 3000.0, 1, 42.0, "p-1", roomSettings);
        GameStateUpdateMessage initialState = new GameStateUpdateMessage(
            "arena-1",
            1234L,
            0L,
            "lobby",
            0L,
            0L,
            false,
            0L,
            null,
            "p-1",
            roomSettings,
            List.of(new PlayerSnapshot("p-1", "Player One", 0, 0.0, 42.0, 0, false, "lobby"))
        );

        when(inboundRateLimiter.allow("principal-1", "join", 500L)).thenReturn(true);
        when(sessionBindingService.bind("principal-1", "ws-session-1", "arena-1", "p-1")).thenReturn(
            SessionBindingService.BindResult.accepted(
                new SessionBindingService.SessionBinding("principal-1", "ws-session-1", "arena-1", "p-1", System.currentTimeMillis())
            )
        );
        when(sessionBindingService.resolvePrincipalsByRoom("arena-1")).thenReturn(List.of("principal-1", "principal-2"));
        when(gameStateService.joinRoom(any(JoinRoomRequest.class))).thenReturn(
            GameStateService.JoinOutcome.accepted(joinedMessage, initialState, null, null)
        );

        gameCommandService.handleJoin(request, "principal-1", "ws-session-1");

        verify(messagingTemplate).convertAndSendToUser("principal-1", "/queue/game.joined", joinedMessage);
        verify(messagingTemplate).convertAndSendToUser("principal-1", "/queue/game.state", initialState);
        verify(messagingTemplate).convertAndSendToUser("principal-2", "/queue/game.state", initialState);
        verify(gameStateService).joinRoom(eq(new JoinRoomRequest("arena-1", "p-1", "Player One")));
    }

    @Test
    public void handleJoinRateLimitSendsErrorInsteadOfLeavingClientConnected() {
        JoinRoomRequest request = new JoinRoomRequest("arena-1", "p-1", "Player One");
        when(inboundRateLimiter.allow("principal-1", "join", 500L)).thenReturn(false);

        gameCommandService.handleJoin(request, "principal-1", "ws-session-1");

        ArgumentCaptor<Object> payloadCaptor = ArgumentCaptor.forClass(Object.class);
        verify(messagingTemplate).convertAndSendToUser(eq("principal-1"), eq("/queue/game.error"), payloadCaptor.capture());
        verifyNoInteractions(sessionBindingService);
        verifyNoInteractions(gameStateService);

        Object payload = payloadCaptor.getValue();
        assertInstanceOf(Map.class, payload);
        Map<?, ?> errorPayload = (Map<?, ?>) payload;
        assertEquals("JOIN_RATE_LIMITED", errorPayload.get("code"));
        assertEquals("arena-1", errorPayload.get("roomId"));
        assertEquals("p-1", errorPayload.get("playerId"));
    }

    @Test
    public void handleJoinInvalidIdsSendsErrorInsteadOfSilentlyReturning() {
        JoinRoomRequest request = new JoinRoomRequest("arena-1", "", "Player One");
        when(inboundRateLimiter.allow("principal-1", "join", 500L)).thenReturn(true);

        gameCommandService.handleJoin(request, "principal-1", "ws-session-1");

        ArgumentCaptor<Object> payloadCaptor = ArgumentCaptor.forClass(Object.class);
        verify(messagingTemplate).convertAndSendToUser(eq("principal-1"), eq("/queue/game.error"), payloadCaptor.capture());
        verify(sessionBindingService, never()).bind(any(), any(), any(), any());
        verifyNoInteractions(gameStateService);

        Object payload = payloadCaptor.getValue();
        assertInstanceOf(Map.class, payload);
        Map<?, ?> errorPayload = (Map<?, ?>) payload;
        assertEquals("INVALID_JOIN_REQUEST", errorPayload.get("code"));
        assertEquals("arena-1", errorPayload.get("roomId"));
        assertEquals("", errorPayload.get("playerId"));
    }
}
