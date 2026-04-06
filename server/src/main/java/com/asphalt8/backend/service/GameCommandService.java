package com.asphalt8.backend.service;

import com.asphalt8.backend.game.dto.AnswerFeedbackMessage;
import com.asphalt8.backend.game.dto.AnswerSubmissionRequest;
import com.asphalt8.backend.game.dto.DecisionChoiceRequest;
import com.asphalt8.backend.game.dto.JoinRoomRequest;
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

    public void handleJoin(JoinRoomRequest request, String principalName) {
        if (!inboundRateLimiter.allow(principalName, "join", 500L)) {
            log.warn("Dropped game.join by rate limiter for principal={}", principalName);
            sendJoinError(
                principalName,
                request.roomId(),
                request.playerId(),
                "JOIN_RATE_LIMITED",
                "Join rejected: too many requests. Please retry in a moment."
            );
            return;
        }

        String normalizedRoomId;
        String normalizedPlayerId;
        try {
            normalizedRoomId = GameInputValidator.normalizeRoomId(request.roomId(), false);
            normalizedPlayerId = GameInputValidator.normalizePlayerId(request.playerId(), false);
        } catch (IllegalArgumentException ex) {
            log.warn("Rejected game.join principal={} because request normalization failed", principalName, ex);
            sendJoinError(
                principalName,
                request.roomId(),
                request.playerId(),
                "INVALID_JOIN_REQUEST",
                "Join rejected: invalid room or player id."
            );
            return;
        }
        String normalizedDisplayName = GameInputValidator.normalizeDisplayName(request.displayName(), normalizedPlayerId);

        SessionBindingService.BindResult bindResult = sessionBindingService.bind(
            principalName,
            normalizedRoomId,
            normalizedPlayerId
        );
        if (!bindResult.accepted()) {
            log.warn(
                "Rejected game.join principal={} roomId={} playerId={} because binding failed code={}",
                principalName,
                normalizedRoomId,
                normalizedPlayerId,
                bindResult.errorCode()
            );
            sendJoinError(
                principalName,
                normalizedRoomId,
                normalizedPlayerId,
                bindResult.errorCode() == null ? "BIND_REJECTED" : bindResult.errorCode(),
                bindResult.errorMessage() == null
                    ? "Join rejected: player is already active in another session."
                    : bindResult.errorMessage()
            );
            return;
        }

        JoinRoomRequest normalizedRequest = new JoinRoomRequest(
            normalizedRoomId,
            normalizedPlayerId,
            normalizedDisplayName
        );

        GameStateService.JoinOutcome joinOutcome = gameStateService.joinRoom(normalizedRequest);
        var joined = joinOutcome.joinedMessage();
        var immediateState = joinOutcome.immediateStateUpdate();
        log.info(
            "Accepted game.join principal={} roomId={} playerId={} playersInSnapshot={}",
            principalName,
            joined.roomId(),
            joined.targetPlayerId(),
            immediateState == null ? 0 : immediateState.players().size()
        );

        sendToPrincipal(principalName, "/queue/game.joined", joined);
        if (immediateState != null) {
            var roomPrincipals = sessionBindingService.resolvePrincipalsByRoom(immediateState.roomId());
            if (roomPrincipals.isEmpty()) {
                sendToPrincipal(principalName, "/queue/game.state", immediateState);
            } else {
                roomPrincipals.forEach(targetPrincipal -> sendToPrincipal(targetPrincipal, "/queue/game.state", immediateState));
            }
        }

        for (var question : joinOutcome.questionMessages()) {
            sessionBindingService
                .resolvePrincipal(question.roomId(), question.targetPlayerId())
                .ifPresent(targetPrincipal -> sendToPrincipal(targetPrincipal, "/queue/game.question", question));
        }
    }

    public void handleAnswer(AnswerSubmissionRequest request, String principalName) {
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

        if (!sessionBindingService.isAuthorized(principalName, normalizedRoomId, normalizedPlayerId)) {
            return;
        }

        AnswerSubmissionRequest normalizedRequest = new AnswerSubmissionRequest(
            normalizedRoomId,
            normalizedPlayerId,
            request.questionId(),
            request.answer()
        );

        GameStateService.AnswerOutcome outcome = gameStateService.submitAnswer(normalizedRequest);
        if (outcome.roomId() == null || outcome.playerId() == null) {
            return;
        }

        String targetPrincipal = sessionBindingService
            .resolvePrincipal(outcome.roomId(), outcome.playerId())
            .orElse(principalName);

        sendToPrincipal(
            targetPrincipal,
            "/queue/game.answer-feedback",
            new AnswerFeedbackMessage(outcome.roomId(), outcome.playerId(), outcome.accepted(), outcome.correct())
        );
        if (outcome.nextQuestion() != null) {
            sendToPrincipal(targetPrincipal, "/queue/game.question", outcome.nextQuestion());
        }
        if (outcome.decisionPoint() != null) {
            sendToPrincipal(targetPrincipal, "/queue/game.decision", outcome.decisionPoint());
        }
    }

    public void handleDecision(DecisionChoiceRequest request, String principalName) {
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

        if (!sessionBindingService.isAuthorized(principalName, normalizedRoomId, normalizedPlayerId)) {
            return;
        }

        DecisionChoiceRequest normalizedRequest = new DecisionChoiceRequest(
            normalizedRoomId,
            normalizedPlayerId,
            request.eventId(),
            request.choice()
        );

        GameStateService.DecisionOutcome outcome = gameStateService.chooseDecision(normalizedRequest);
        if (outcome.roomId() == null || outcome.playerId() == null) {
            return;
        }
        if (outcome.nextQuestion() == null) {
            return;
        }

        String targetPrincipal = sessionBindingService
            .resolvePrincipal(outcome.roomId(), outcome.playerId())
            .orElse(principalName);
        sendToPrincipal(targetPrincipal, "/queue/game.question", outcome.nextQuestion());
    }

    private void sendToPrincipal(String principalName, String destination, Object payload) {
        log.info("Sending destination={} to principal={}", destination, principalName);
        messagingTemplate.convertAndSendToUser(principalName, destination, payload);
    }

    private void sendJoinError(
        String principalName,
        String roomId,
        String playerId,
        String code,
        String message
    ) {
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
