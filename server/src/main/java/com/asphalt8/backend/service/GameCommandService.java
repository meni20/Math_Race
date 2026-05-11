package com.asphalt8.backend.service;

import com.asphalt8.backend.game.dto.AnswerFeedbackMessage;
import com.asphalt8.backend.game.dto.AnswerSubmissionRequest;
import com.asphalt8.backend.game.dto.DecisionChoiceRequest;
import com.asphalt8.backend.game.dto.DecisionPointMessage;
import com.asphalt8.backend.game.dto.GameStateUpdateMessage;
import com.asphalt8.backend.game.dto.JoinRoomRequest;
import com.asphalt8.backend.game.dto.QuestionMessage;
import com.asphalt8.backend.game.dto.RoomPlayerRequest;
import com.asphalt8.backend.game.dto.UpdateRoomSettingsRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

@Service
public class GameCommandService {

    private static final Logger log = LoggerFactory.getLogger(GameCommandService.class);

    private final GameStateService gameStateService;
    private final SessionBindingService sessionBindingService;
    private final InboundRateLimiter inboundRateLimiter;
    private final SimpMessagingTemplate messagingTemplate;

    public GameCommandService(
        GameStateService gameStateService,
        SessionBindingService sessionBindingService,
        InboundRateLimiter inboundRateLimiter,
        SimpMessagingTemplate messagingTemplate
    ) {
        this.gameStateService = gameStateService;
        this.sessionBindingService = sessionBindingService;
        this.inboundRateLimiter = inboundRateLimiter;
        this.messagingTemplate = messagingTemplate;
    }

    public void handleJoin(JoinRoomRequest request, String principalName, String websocketSessionId) {
        if (!inboundRateLimiter.allow(principalName, "join", 500L)) {
            sendError(principalName, request.roomId(), request.playerId(), "JOIN_RATE_LIMITED", "Join rejected: too many requests. Please retry in a moment.");
            return;
        }

        String normalizedRoomId;
        String normalizedPlayerId;
        try {
            normalizedRoomId = GameInputValidator.normalizeRoomId(request.roomId(), false);
            normalizedPlayerId = GameInputValidator.normalizePlayerId(request.playerId(), false);
        } catch (IllegalArgumentException ex) {
            sendError(principalName, request.roomId(), request.playerId(), "INVALID_JOIN_REQUEST", "Join rejected: invalid room or player id.");
            return;
        }

        String normalizedDisplayName = GameInputValidator.normalizeDisplayName(request.displayName(), normalizedPlayerId);
        SessionBindingService.BindResult bindResult = sessionBindingService.bind(
            principalName,
            websocketSessionId,
            normalizedRoomId,
            normalizedPlayerId
        );
        if (!bindResult.accepted()) {
            sendError(
                principalName,
                normalizedRoomId,
                normalizedPlayerId,
                bindResult.errorCode() == null ? "BIND_REJECTED" : bindResult.errorCode(),
                bindResult.errorMessage() == null ? "Join rejected: player is already active in another session." : bindResult.errorMessage()
            );
            return;
        }

        GameStateService.JoinOutcome outcome = gameStateService.joinRoom(
            new JoinRoomRequest(normalizedRoomId, normalizedPlayerId, normalizedDisplayName)
        );
        if (!outcome.accepted()) {
            sessionBindingService.unregister(principalName, websocketSessionId);
            sendError(
                principalName,
                normalizedRoomId,
                normalizedPlayerId,
                outcome.errorCode() == null ? "JOIN_REJECTED" : outcome.errorCode(),
                outcome.errorMessage() == null ? "Join rejected." : outcome.errorMessage()
            );
            return;
        }

        sendToPrincipal(principalName, "/queue/game.joined", outcome.joinedMessage());
        if (outcome.stateUpdate() != null) {
            broadcastState(outcome.stateUpdate());
        }
        sendPromptIfPresent(principalName, outcome.question(), outcome.decision());
    }

    public void handleSync(RoomPlayerRequest request, String principalName, String websocketSessionId) {
        if (!inboundRateLimiter.allow(principalName, "sync", 75L)) {
            return;
        }

        RoomPlayerRequest normalizedRequest = normalizeRoomPlayerRequest(request);
        if (normalizedRequest == null) {
            sendError(principalName, request.roomId(), request.playerId(), "INVALID_REQUEST", "Invalid room or player id.");
            return;
        }
        if (!sessionBindingService.isAuthorized(principalName, websocketSessionId, normalizedRequest.roomId(), normalizedRequest.playerId())) {
            sendError(principalName, normalizedRequest.roomId(), normalizedRequest.playerId(), "SESSION_NOT_AUTHORIZED", "Rejoin the room to continue.");
            return;
        }

        GameStateService.CommandOutcome outcome = gameStateService.syncRoom(normalizedRequest);
        if (!outcome.accepted()) {
            sendStateIfPresent(principalName, outcome.stateUpdate());
            sendError(
                principalName,
                normalizedRequest.roomId(),
                normalizedRequest.playerId(),
                outcome.errorCode() == null ? "SYNC_REJECTED" : outcome.errorCode(),
                outcome.errorMessage() == null ? "Sync rejected." : outcome.errorMessage()
            );
            return;
        }

        sendStateIfPresent(principalName, outcome.stateUpdate());
        sendPromptIfPresent(principalName, outcome.question(), outcome.decision());
    }

    public void handleStartRace(RoomPlayerRequest request, String principalName, String websocketSessionId) {
        if (!inboundRateLimiter.allow(principalName, "start", 250L)) {
            return;
        }

        RoomPlayerRequest normalizedRequest = normalizeRoomPlayerRequest(request);
        if (normalizedRequest == null) {
            sendError(principalName, request.roomId(), request.playerId(), "INVALID_REQUEST", "Invalid room or player id.");
            return;
        }
        if (!sessionBindingService.isAuthorized(principalName, websocketSessionId, normalizedRequest.roomId(), normalizedRequest.playerId())) {
            sendError(principalName, normalizedRequest.roomId(), normalizedRequest.playerId(), "SESSION_NOT_AUTHORIZED", "Rejoin the room to continue.");
            return;
        }

        GameStateService.CommandOutcome outcome = gameStateService.startRace(normalizedRequest);
        if (!outcome.accepted()) {
            sendStateIfPresent(principalName, outcome.stateUpdate());
            sendError(
                principalName,
                normalizedRequest.roomId(),
                normalizedRequest.playerId(),
                outcome.errorCode() == null ? "START_REJECTED" : outcome.errorCode(),
                outcome.errorMessage() == null ? "Start rejected." : outcome.errorMessage()
            );
            return;
        }

        if (outcome.stateUpdate() != null) {
            broadcastState(outcome.stateUpdate());
        }
    }

    public void handleAnswer(AnswerSubmissionRequest request, String principalName, String websocketSessionId) {
        if (!inboundRateLimiter.allow(principalName, "answer", 75L)) {
            return;
        }

        String normalizedRoomId;
        String normalizedPlayerId;
        try {
            normalizedRoomId = GameInputValidator.normalizeRoomId(request.roomId(), false);
            normalizedPlayerId = GameInputValidator.normalizePlayerId(request.playerId(), false);
        } catch (IllegalArgumentException ex) {
            return;
        }

        if (!sessionBindingService.isAuthorized(principalName, websocketSessionId, normalizedRoomId, normalizedPlayerId)) {
            sendError(principalName, normalizedRoomId, normalizedPlayerId, "SESSION_NOT_AUTHORIZED", "Rejoin the room to continue.");
            return;
        }

        GameStateService.AnswerOutcome outcome = gameStateService.submitAnswer(
            new AnswerSubmissionRequest(normalizedRoomId, normalizedPlayerId, request.questionId(), request.answer())
        );
        if (outcome.errorCode() != null) {
            sendError(principalName, normalizedRoomId, normalizedPlayerId, outcome.errorCode(), outcome.errorMessage());
            return;
        }

        sendToPrincipal(
            principalName,
            "/queue/game.answer-feedback",
            new AnswerFeedbackMessage(outcome.roomId(), outcome.playerId(), outcome.accepted(), outcome.correct())
        );
        if (outcome.stateUpdate() != null) {
            broadcastState(outcome.stateUpdate());
        }
        sendPromptIfPresent(principalName, outcome.question(), outcome.decision());
    }

    public void handleDecision(DecisionChoiceRequest request, String principalName, String websocketSessionId) {
        if (!inboundRateLimiter.allow(principalName, "decision", 120L)) {
            return;
        }

        String normalizedRoomId;
        String normalizedPlayerId;
        try {
            normalizedRoomId = GameInputValidator.normalizeRoomId(request.roomId(), false);
            normalizedPlayerId = GameInputValidator.normalizePlayerId(request.playerId(), false);
        } catch (IllegalArgumentException ex) {
            return;
        }

        if (!sessionBindingService.isAuthorized(principalName, websocketSessionId, normalizedRoomId, normalizedPlayerId)) {
            sendError(principalName, normalizedRoomId, normalizedPlayerId, "SESSION_NOT_AUTHORIZED", "Rejoin the room to continue.");
            return;
        }

        GameStateService.DecisionOutcome outcome = gameStateService.chooseDecision(
            new DecisionChoiceRequest(normalizedRoomId, normalizedPlayerId, request.eventId(), request.choice())
        );
        if (outcome.errorCode() != null) {
            sendError(principalName, normalizedRoomId, normalizedPlayerId, outcome.errorCode(), outcome.errorMessage());
            return;
        }

        if (outcome.stateUpdate() != null) {
            broadcastState(outcome.stateUpdate());
        }
        if (outcome.nextQuestion() != null) {
            sendToPrincipal(principalName, "/queue/game.question", outcome.nextQuestion());
        }
    }

    public void handleReturnToLobby(RoomPlayerRequest request, String principalName, String websocketSessionId) {
        RoomPlayerRequest normalizedRequest = normalizeRoomPlayerRequest(request);
        if (normalizedRequest == null) {
            sendError(principalName, request.roomId(), request.playerId(), "INVALID_REQUEST", "Invalid room or player id.");
            return;
        }
        if (!sessionBindingService.isAuthorized(principalName, websocketSessionId, normalizedRequest.roomId(), normalizedRequest.playerId())) {
            sendError(principalName, normalizedRequest.roomId(), normalizedRequest.playerId(), "SESSION_NOT_AUTHORIZED", "Rejoin the room to continue.");
            return;
        }

        GameStateService.CommandOutcome outcome = gameStateService.returnPlayerToLobby(normalizedRequest);
        if (!outcome.accepted()) {
            sendStateIfPresent(principalName, outcome.stateUpdate());
            sendError(principalName, normalizedRequest.roomId(), normalizedRequest.playerId(), outcome.errorCode(), outcome.errorMessage());
            return;
        }

        if (outcome.stateUpdate() != null) {
            broadcastState(outcome.stateUpdate());
        }
    }

    public void handleLeave(RoomPlayerRequest request, String principalName, String websocketSessionId) {
        RoomPlayerRequest normalizedRequest = normalizeRoomPlayerRequest(request);
        if (normalizedRequest == null) {
            return;
        }
        if (!sessionBindingService.isAuthorized(principalName, websocketSessionId, normalizedRequest.roomId(), normalizedRequest.playerId())) {
            sendError(principalName, normalizedRequest.roomId(), normalizedRequest.playerId(), "SESSION_NOT_AUTHORIZED", "Rejoin the room to continue.");
            return;
        }

        GameStateService.CommandOutcome outcome = gameStateService.leaveRoom(normalizedRequest);
        sessionBindingService.unregister(principalName, websocketSessionId);
        if (outcome.stateUpdate() != null) {
            broadcastState(outcome.stateUpdate());
        }
    }

    public void handleUpdateRoomSettings(UpdateRoomSettingsRequest request, String principalName, String websocketSessionId) {
        RoomPlayerRequest normalizedRequest = normalizeRoomPlayerRequest(new RoomPlayerRequest(request.roomId(), request.playerId()));
        if (normalizedRequest == null) {
            sendError(principalName, request.roomId(), request.playerId(), "INVALID_REQUEST", "Invalid room or player id.");
            return;
        }
        if (!sessionBindingService.isAuthorized(principalName, websocketSessionId, normalizedRequest.roomId(), normalizedRequest.playerId())) {
            sendError(principalName, normalizedRequest.roomId(), normalizedRequest.playerId(), "SESSION_NOT_AUTHORIZED", "Rejoin the room to continue.");
            return;
        }

        GameStateService.CommandOutcome outcome = gameStateService.updateRoomSettings(
            new UpdateRoomSettingsRequest(normalizedRequest.roomId(), normalizedRequest.playerId(), request.roomSettings())
        );
        if (!outcome.accepted()) {
            sendStateIfPresent(principalName, outcome.stateUpdate());
            sendError(principalName, normalizedRequest.roomId(), normalizedRequest.playerId(), outcome.errorCode(), outcome.errorMessage());
            return;
        }

        if (outcome.stateUpdate() != null) {
            broadcastState(outcome.stateUpdate());
        }
    }

    private RoomPlayerRequest normalizeRoomPlayerRequest(RoomPlayerRequest request) {
        try {
            return new RoomPlayerRequest(
                GameInputValidator.normalizeRoomId(request.roomId(), false),
                GameInputValidator.normalizePlayerId(request.playerId(), false)
            );
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    private void broadcastState(GameStateUpdateMessage stateUpdate) {
        for (String targetPrincipal : sessionBindingService.resolvePrincipalsByRoom(stateUpdate.roomId())) {
            sendToPrincipal(targetPrincipal, "/queue/game.state", stateUpdate);
        }
    }

    private void sendStateIfPresent(String principalName, GameStateUpdateMessage stateUpdate) {
        if (stateUpdate != null) {
            sendToPrincipal(principalName, "/queue/game.state", stateUpdate);
        }
    }

    private void sendPromptIfPresent(String principalName, QuestionMessage question, DecisionPointMessage decision) {
        if (question != null) {
            sendToPrincipal(principalName, "/queue/game.question", question);
        }
        if (decision != null) {
            sendToPrincipal(principalName, "/queue/game.decision", decision);
        }
    }

    private void sendToPrincipal(String principalName, String destination, Object payload) {
        messagingTemplate.convertAndSendToUser(principalName, destination, payload);
    }

    private void sendError(String principalName, String roomId, String playerId, String code, String message) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("code", code);
        payload.put("message", message);
        if (roomId != null) {
            payload.put("roomId", roomId);
        }
        if (playerId != null) {
            payload.put("playerId", playerId);
        }
        sendToPrincipal(principalName, "/queue/game.error", payload);
    }
}
