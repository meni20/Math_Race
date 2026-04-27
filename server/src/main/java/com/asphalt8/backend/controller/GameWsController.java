package com.asphalt8.backend.controller;

import com.asphalt8.backend.game.dto.AnswerSubmissionRequest;
import com.asphalt8.backend.game.dto.DecisionChoiceRequest;
import com.asphalt8.backend.game.dto.JoinRoomRequest;
import com.asphalt8.backend.game.dto.RoomPlayerRequest;
import com.asphalt8.backend.game.dto.UpdateRoomSettingsRequest;
import com.asphalt8.backend.service.GameCommandService;
import java.security.Principal;
import org.springframework.messaging.handler.annotation.Header;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

@Controller
public class GameWsController {

    private static final Logger log = LoggerFactory.getLogger(GameWsController.class);

    private final GameCommandService gameCommandService;

    public GameWsController(GameCommandService gameCommandService) {
        this.gameCommandService = gameCommandService;
    }

    @MessageMapping("/game.join")
    public void joinRoom(JoinRoomRequest request, Principal principal, @Header("simpSessionId") String websocketSessionId) {
        if (principal == null) {
            log.warn("Rejected game.join because principal was null for roomId={} playerId={}", request.roomId(), request.playerId());
            return;
        }
        log.info("Received game.join principal={} roomId={} playerId={}", principal.getName(), request.roomId(), request.playerId());
        gameCommandService.handleJoin(request, principal.getName(), websocketSessionId);
    }

    @MessageMapping("/game.answer")
    public void submitAnswer(AnswerSubmissionRequest request, Principal principal, @Header("simpSessionId") String websocketSessionId) {
        if (principal == null) {
            return;
        }
        gameCommandService.handleAnswer(request, principal.getName(), websocketSessionId);
    }

    @MessageMapping("/game.decision")
    public void submitDecision(DecisionChoiceRequest request, Principal principal, @Header("simpSessionId") String websocketSessionId) {
        if (principal == null) {
            return;
        }
        gameCommandService.handleDecision(request, principal.getName(), websocketSessionId);
    }

    @MessageMapping("/game.start")
    public void startRace(RoomPlayerRequest request, Principal principal, @Header("simpSessionId") String websocketSessionId) {
        if (principal == null) {
            return;
        }
        gameCommandService.handleStartRace(request, principal.getName(), websocketSessionId);
    }

    @MessageMapping("/game.sync")
    public void syncRoom(RoomPlayerRequest request, Principal principal, @Header("simpSessionId") String websocketSessionId) {
        if (principal == null) {
            return;
        }
        gameCommandService.handleSync(request, principal.getName(), websocketSessionId);
    }

    @MessageMapping("/game.returnToLobby")
    public void returnToLobby(RoomPlayerRequest request, Principal principal, @Header("simpSessionId") String websocketSessionId) {
        if (principal == null) {
            return;
        }
        gameCommandService.handleReturnToLobby(request, principal.getName(), websocketSessionId);
    }

    @MessageMapping("/game.leave")
    public void leaveRoom(RoomPlayerRequest request, Principal principal, @Header("simpSessionId") String websocketSessionId) {
        if (principal == null) {
            return;
        }
        gameCommandService.handleLeave(request, principal.getName(), websocketSessionId);
    }

    @MessageMapping("/game.updateRoomSettings")
    public void updateRoomSettings(UpdateRoomSettingsRequest request, Principal principal, @Header("simpSessionId") String websocketSessionId) {
        if (principal == null) {
            return;
        }
        gameCommandService.handleUpdateRoomSettings(request, principal.getName(), websocketSessionId);
    }
}
