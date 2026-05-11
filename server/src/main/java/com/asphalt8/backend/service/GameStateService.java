package com.asphalt8.backend.service;

import com.asphalt8.backend.entity.UserProfile;
import com.asphalt8.backend.game.dto.AnswerFeedbackMessage;
import com.asphalt8.backend.game.dto.AnswerSubmissionRequest;
import com.asphalt8.backend.game.dto.DecisionChoiceRequest;
import com.asphalt8.backend.game.dto.DecisionPointMessage;
import com.asphalt8.backend.game.dto.GameStateUpdateMessage;
import com.asphalt8.backend.game.dto.JoinRoomRequest;
import com.asphalt8.backend.game.dto.PlayerSnapshot;
import com.asphalt8.backend.game.dto.QuestionMessage;
import com.asphalt8.backend.game.dto.RoomJoinedMessage;
import com.asphalt8.backend.game.dto.RoomPlayerRequest;
import com.asphalt8.backend.game.dto.RoomSettings;
import com.asphalt8.backend.game.dto.UpdateRoomSettingsRequest;
import com.asphalt8.backend.game.model.DecisionPoint;
import com.asphalt8.backend.game.model.GameRoomState;
import com.asphalt8.backend.game.model.GeneratedQuestion;
import com.asphalt8.backend.game.model.PendingQuestion;
import com.asphalt8.backend.game.model.PlayerState;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class GameStateService {

    private static final Logger log = LoggerFactory.getLogger(GameStateService.class);

    private static final double BASE_SPEED_MPS = 42.0;
    private static final double MIN_SPEED_MPS = 18.0;
    private static final double BASE_ACCEL_MPS2 = 11.0;
    private static final double BOOST_ACCEL_MPS2 = 28.0;
    private static final double DRAG_MPS2 = 8.0;
    private static final double BOOST_EXTRA_SPEED_MPS = 30.0;
    private static final long BASE_BOOST_DURATION_MS = 3000L;
    private static final double WRONG_ANSWER_SPEED_PENALTY_MPS = 7.5;
    private static final double TIMEOUT_ANSWER_SPEED_PENALTY_MPS = 9.5;
    private static final long ANSWER_GRACE_MS = 350L;
    private static final double DECISION_TRIGGER_PROBABILITY = 0.22;
    private static final long DECISION_COOLDOWN_MS = 12_000L;
    private static final long DECISION_TTL_MS = 8_000L;
    private static final double HIGHWAY_TELEPORT_METERS = 240.0;
    private static final long HIGHWAY_SUPER_BOOST_MS = 2200L;
    private static final long EMPTY_ROOM_RETENTION_MS = 120_000L;
    private static final long RESULT_PERSIST_RETRY_MS = 5000L;
    private static final long STALE_SESSION_MS = 20_000L;
    private static final long MAX_ADVANCE_STEP_MS = 250L;
    private static final long RACE_START_COUNTDOWN_MS = 2600L;
    private static final int DEFAULT_MAX_PLAYERS = 4;
    private static final int MIN_MAX_PLAYERS = 2;
    private static final int MAX_MAX_PLAYERS = 4;
    private static final int DEFAULT_RACE_DURATION_SECONDS = 180;
    private static final int MIN_RACE_DURATION_SECONDS = 60;
    private static final int MAX_RACE_DURATION_SECONDS = 600;
    private static final int DEFAULT_QUESTION_TIME_LIMIT_SECONDS = 8;
    private static final int MIN_QUESTION_TIME_LIMIT_SECONDS = 5;
    private static final int MAX_QUESTION_TIME_LIMIT_SECONDS = 20;
    private static final String PHASE_LOBBY = "lobby";
    private static final String PHASE_STARTING = "starting";
    private static final String PHASE_ACTIVE = "active";
    private static final String PHASE_FINISH = "finish";

    private final ConcurrentHashMap<String, GameRoomState> rooms = new ConcurrentHashMap<>();
    private final QuestionGeneratorService questionGeneratorService;
    private final RaceHistoryService raceHistoryService;
    private final UserProfileStore userProfileStore;
    private final double configuredTrackLengthMeters;
    private final int configuredTotalLaps;

    public GameStateService(
        QuestionGeneratorService questionGeneratorService,
        RaceHistoryService raceHistoryService,
        UserProfileStore userProfileStore,
        @Value("${game.track-length-meters:3000}") double configuredTrackLengthMeters,
        @Value("${game.total-laps:1}") int configuredTotalLaps
    ) {
        if (configuredTrackLengthMeters <= 0) {
            throw new IllegalArgumentException("game.track-length-meters must be > 0");
        }
        if (configuredTotalLaps <= 0) {
            throw new IllegalArgumentException("game.total-laps must be > 0");
        }
        this.questionGeneratorService = questionGeneratorService;
        this.raceHistoryService = raceHistoryService;
        this.userProfileStore = userProfileStore;
        this.configuredTrackLengthMeters = configuredTrackLengthMeters;
        this.configuredTotalLaps = configuredTotalLaps;
    }

    public JoinOutcome joinRoom(JoinRoomRequest request) {
        String roomId = normalizeRoomId(request.roomId());
        String playerId = normalizePlayerId(request.playerId());
        String displayName = normalizeDisplayName(request.displayName(), playerId);
        long now = System.currentTimeMillis();
        saveUserProfile(playerId, displayName);

        GameRoomState room = rooms.computeIfAbsent(
            roomId,
            id -> new GameRoomState(id, configuredTrackLengthMeters, configuredTotalLaps)
        );

        synchronized (room.getLock()) {
            advanceRoomToNow(room, now);

            PlayerState player = room.getPlayers().get(playerId);
            boolean existingMember = player != null;
            if (!existingMember && !PHASE_LOBBY.equals(room.getRacePhase())) {
                return JoinOutcome.rejected(
                    roomId,
                    playerId,
                    "ROOM_MEMBERSHIP_LOCKED",
                    "Join rejected: room is not in the lobby. New players can only join before the race starts."
                );
            }

            if (!existingMember && room.getPlayers().size() >= room.getRoomSettings().maxPlayers()) {
                return JoinOutcome.rejected(
                    roomId,
                    playerId,
                    "ROOM_FULL",
                    "Join rejected: this classroom race is already full."
                );
            }

            if (player == null) {
                player = createPlayerState(playerId, displayName, room.getPlayers().size() % 4);
                room.getPlayers().put(playerId, player);
            } else {
                player.setDisplayName(displayName);
            }

            if (room.getRoomCreatorPlayerId() == null) {
                room.setRoomCreatorPlayerId(player.getPlayerId());
            }

            room.setRoomSettings(normalizeRoomSettings(
                room.getRoomId(),
                room.getRoomSettings(),
                Math.max(MIN_MAX_PLAYERS, room.getPlayers().size())
            ));

            player.setLastSeenAtMs(now);
            room.setLastInteractionAtMs(now);

            if (PHASE_ACTIVE.equals(room.getRacePhase()) && PHASE_ACTIVE.equals(player.getRacePhase())) {
                if (player.getPendingDecisionPoint() != null && now > player.getPendingDecisionPoint().expiresAtMs()) {
                    player.setPendingDecisionPoint(null);
                }
                if (player.getPendingQuestion() == null || now > player.getPendingQuestion().getExpiresAtMs()) {
                    issueNewQuestion(room, player, 1, false, now);
                }
            } else if (!PHASE_ACTIVE.equals(player.getRacePhase())) {
                player.setPendingQuestion(null);
                player.setPendingDecisionPoint(null);
            }

            PromptBundle prompt = currentPrompt(room, player, now);
            return JoinOutcome.accepted(
                buildJoinMessage(room, player),
                buildStateUpdate(room, now),
                prompt.question(),
                prompt.decision()
            );
        }
    }

    public CommandOutcome startRace(RoomPlayerRequest request) {
        String roomId = normalizeExistingRoomId(request.roomId());
        String playerId = normalizeExistingPlayerId(request.playerId());
        long now = System.currentTimeMillis();
        GameRoomState room = rooms.get(roomId);
        if (room == null) {
            return CommandOutcome.rejected(roomId, playerId, "ROOM_NOT_FOUND", "Race room not found.");
        }

        synchronized (room.getLock()) {
            advanceRoomToNow(room, now);
            PlayerState player = room.getPlayers().get(playerId);
            if (player == null) {
                return CommandOutcome.rejected(roomId, playerId, "SESSION_NOT_AUTHORIZED", "Rejoin the room to continue.");
            }

            player.setLastSeenAtMs(now);
            room.setLastInteractionAtMs(now);

            if (!PHASE_LOBBY.equals(room.getRacePhase()) || !allPlayersInLobby(room)) {
                return CommandOutcome.rejected(
                    roomId,
                    playerId,
                    buildStateUpdate(room, now),
                    "ROOM_NOT_READY",
                    "Race can only start when all room members are back in the lobby."
                );
            }

            scheduleRaceStart(room, now);
            return CommandOutcome.accepted(roomId, playerId, buildStateUpdate(room, now), null, null);
        }
    }

    public CommandOutcome syncRoom(RoomPlayerRequest request) {
        String roomId = normalizeExistingRoomId(request.roomId());
        String playerId = normalizeExistingPlayerId(request.playerId());
        long now = System.currentTimeMillis();
        GameRoomState room = rooms.get(roomId);
        if (room == null) {
            return CommandOutcome.rejected(roomId, playerId, "ROOM_NOT_FOUND", "Race room not found.");
        }

        synchronized (room.getLock()) {
            advanceRoomToNow(room, now);
            PlayerState player = room.getPlayers().get(playerId);
            if (player == null) {
                return CommandOutcome.rejected(roomId, playerId, "SESSION_NOT_AUTHORIZED", "Rejoin the room to continue.");
            }

            player.setLastSeenAtMs(now);
            room.setLastInteractionAtMs(now);
            PromptBundle prompt = currentPrompt(room, player, now);
            return CommandOutcome.accepted(roomId, playerId, buildStateUpdate(room, now), prompt.question(), prompt.decision());
        }
    }

    public AnswerOutcome submitAnswer(AnswerSubmissionRequest request) {
        String roomId = normalizeExistingRoomId(request.roomId());
        String playerId = normalizeExistingPlayerId(request.playerId());
        long now = System.currentTimeMillis();
        GameRoomState room = rooms.get(roomId);
        if (room == null) {
            return AnswerOutcome.rejected(roomId, playerId, false, "ROOM_NOT_FOUND", "Race room not found.");
        }

        synchronized (room.getLock()) {
            advanceRoomToNow(room, now);
            PlayerState player = room.getPlayers().get(playerId);
            if (player == null) {
                return AnswerOutcome.rejected(roomId, playerId, false, "SESSION_NOT_AUTHORIZED", "Rejoin the room to continue.");
            }

            player.setLastSeenAtMs(now);
            room.setLastInteractionAtMs(now);

            if (player.isFinished() || room.isRaceStopped() || !PHASE_ACTIVE.equals(room.getRacePhase()) || !PHASE_ACTIVE.equals(player.getRacePhase())) {
                return AnswerOutcome.rejected(roomId, playerId, false, null, null)
                    .withState(buildStateUpdate(room, now));
            }

            DecisionPoint activeDecision = player.getPendingDecisionPoint();
            if (activeDecision != null && now <= activeDecision.expiresAtMs()) {
                return AnswerOutcome.rejected(roomId, playerId, false, null, null)
                    .withState(buildStateUpdate(room, now));
            }
            if (activeDecision != null && now > activeDecision.expiresAtMs()) {
                player.setPendingDecisionPoint(null);
            }

            PendingQuestion pending = player.getPendingQuestion();
            if (pending == null) {
                issueNewQuestion(room, player, 1, false, now);
                return AnswerOutcome.rejected(roomId, playerId, false, null, null)
                    .withState(buildStateUpdate(room, now))
                    .withQuestion(toQuestionMessage(room.getRoomId(), player, player.getPendingQuestion()));
            }

            boolean expectedQuestion = pending.getQuestion().questionId().equals(request.questionId());
            if (!expectedQuestion) {
                PromptBundle prompt = currentPrompt(room, player, now);
                return AnswerOutcome.rejected(roomId, playerId, false, null, null)
                    .withState(buildStateUpdate(room, now))
                    .withQuestion(prompt.question())
                    .withDecision(prompt.decision());
            }

            boolean notExpired = now <= (pending.getExpiresAtMs() + ANSWER_GRACE_MS);
            String submittedAnswer = request.answer() == null ? "" : request.answer().trim();
            boolean correct = notExpired && submittedAnswer.equalsIgnoreCase(pending.getQuestion().correctAnswer().trim());

            if (correct) {
                player.setCorrectStreak(player.getCorrectStreak() + 1);
                long boostDuration = BASE_BOOST_DURATION_MS;
                double boostMultiplier = pending.getQuestion().boostMultiplier();
                if (pending.isFromHighwayChallenge()) {
                    player.setPositionMeters(player.getPositionMeters() + HIGHWAY_TELEPORT_METERS);
                    boostMultiplier *= 1.35;
                    boostDuration += HIGHWAY_SUPER_BOOST_MS;
                    player.setHighwayChallengeActive(false);
                }
                applyBoost(player, boostMultiplier, boostDuration, now);
            } else {
                player.setCorrectStreak(0);
                player.setHighwayChallengeActive(false);
                player.setSpeedMps(Math.max(MIN_SPEED_MPS, player.getSpeedMps() - WRONG_ANSWER_SPEED_PENALTY_MPS));
            }

            player.setPendingQuestion(null);

            DecisionPointMessage decisionPoint = null;
            if (correct && shouldOfferDecision(player, now)) {
                decisionPoint = issueDecision(room, player, now);
            } else {
                issueNewQuestion(room, player, calculateDifficulty(player, correct), false, now);
            }

            PromptBundle prompt = currentPrompt(room, player, now);
            return AnswerOutcome.accepted(
                roomId,
                playerId,
                correct,
                buildStateUpdate(room, now),
                prompt.question(),
                decisionPoint != null ? decisionPoint : prompt.decision()
            );
        }
    }

    public DecisionOutcome chooseDecision(DecisionChoiceRequest request) {
        String roomId = normalizeExistingRoomId(request.roomId());
        String playerId = normalizeExistingPlayerId(request.playerId());
        long now = System.currentTimeMillis();
        GameRoomState room = rooms.get(roomId);
        if (room == null) {
            return DecisionOutcome.rejected(roomId, playerId, "ROOM_NOT_FOUND", "Race room not found.");
        }

        synchronized (room.getLock()) {
            advanceRoomToNow(room, now);
            PlayerState player = room.getPlayers().get(playerId);
            if (player == null) {
                return DecisionOutcome.rejected(roomId, playerId, "SESSION_NOT_AUTHORIZED", "Rejoin the room to continue.");
            }

            player.setLastSeenAtMs(now);
            room.setLastInteractionAtMs(now);

            if (player.isFinished() || room.isRaceStopped() || !PHASE_ACTIVE.equals(room.getRacePhase()) || !PHASE_ACTIVE.equals(player.getRacePhase())) {
                return DecisionOutcome.rejected(roomId, playerId, null, null)
                    .withState(buildStateUpdate(room, now));
            }

            DecisionPoint point = player.getPendingDecisionPoint();
            if (point == null || !point.eventId().equals(request.eventId()) || now > point.expiresAtMs()) {
                if (point != null && now > point.expiresAtMs()) {
                    player.setPendingDecisionPoint(null);
                    if (player.getPendingQuestion() == null) {
                        issueNewQuestion(room, player, 1, false, now);
                    }
                }
                PromptBundle prompt = currentPrompt(room, player, now);
                return DecisionOutcome.rejected(roomId, playerId, null, null)
                    .withState(buildStateUpdate(room, now))
                    .withQuestion(prompt.question());
            }

            player.setPendingDecisionPoint(null);
            player.setDecisionCooldownUntilMs(now + DECISION_COOLDOWN_MS);

            String choice = request.choice() == null ? "" : request.choice().trim().toUpperCase();
            if ("HIGHWAY".equals(choice)) {
                player.setHighwayChallengeActive(true);
                issueNewQuestion(room, player, 3, true, now);
            } else if ("DIRT".equals(choice)) {
                player.setHighwayChallengeActive(false);
                applyBoost(player, 0.60, 1600L, now);
                issueNewQuestion(room, player, Math.max(1, calculateDifficulty(player, true) - 1), false, now);
            } else {
                player.setPendingDecisionPoint(point);
                return DecisionOutcome.rejected(roomId, playerId, null, null)
                    .withState(buildStateUpdate(room, now));
            }

            PromptBundle prompt = currentPrompt(room, player, now);
            return DecisionOutcome.accepted(roomId, playerId, buildStateUpdate(room, now), prompt.question());
        }
    }

    public CommandOutcome returnPlayerToLobby(RoomPlayerRequest request) {
        String roomId = normalizeExistingRoomId(request.roomId());
        String playerId = normalizeExistingPlayerId(request.playerId());
        long now = System.currentTimeMillis();
        GameRoomState room = rooms.get(roomId);
        if (room == null) {
            return CommandOutcome.rejected(roomId, playerId, "ROOM_NOT_FOUND", "Race room not found.");
        }

        synchronized (room.getLock()) {
            advanceRoomToNow(room, now);
            PlayerState player = room.getPlayers().get(playerId);
            if (player == null) {
                return CommandOutcome.rejected(roomId, playerId, "SESSION_NOT_AUTHORIZED", "Rejoin the room to continue.");
            }

            resetPlayerForNewRace(player);
            player.setRacePhase(PHASE_LOBBY);
            player.setLastSeenAtMs(now);
            room.setLastInteractionAtMs(now);

            if (!anyPlayersActivelyRacing(room)) {
                resetRoomForNewRace(room, now);
            }

            return CommandOutcome.accepted(roomId, playerId, buildStateUpdate(room, now), null, null);
        }
    }

    public CommandOutcome leaveRoom(RoomPlayerRequest request) {
        String roomId = normalizeExistingRoomId(request.roomId());
        String playerId = normalizeExistingPlayerId(request.playerId());
        long now = System.currentTimeMillis();
        GameRoomState room = rooms.get(roomId);
        if (room == null) {
            return CommandOutcome.accepted(roomId, playerId, null, null, null);
        }

        synchronized (room.getLock()) {
            advanceRoomToNow(room, now);
            PlayerState removed = room.getPlayers().remove(playerId);
            if (removed == null) {
                return CommandOutcome.accepted(roomId, playerId, buildStateUpdate(room, now), null, null);
            }

            if (playerId.equals(room.getWinnerPlayerId())) {
                room.setWinnerPlayerId(null);
            }
            if (playerId.equals(room.getRoomCreatorPlayerId())) {
                room.setRoomCreatorPlayerId(pickNextRoomCreator(room));
            }

            rebalanceLanes(room);
            room.setRoomSettings(normalizeRoomSettings(
                room.getRoomId(),
                room.getRoomSettings(),
                Math.max(MIN_MAX_PLAYERS, room.getPlayers().size() == 0 ? MIN_MAX_PLAYERS : room.getPlayers().size())
            ));
            if (!anyPlayersActivelyRacing(room)) {
                resetRoomForNewRace(room, now);
            }
            room.setLastInteractionAtMs(now);
            return CommandOutcome.accepted(roomId, playerId, buildStateUpdate(room, now), null, null);
        }
    }

    public CommandOutcome updateRoomSettings(UpdateRoomSettingsRequest request) {
        String roomId = normalizeExistingRoomId(request.roomId());
        String playerId = normalizeExistingPlayerId(request.playerId());
        long now = System.currentTimeMillis();
        GameRoomState room = rooms.get(roomId);
        if (room == null) {
            return CommandOutcome.rejected(roomId, playerId, "ROOM_NOT_FOUND", "Race room not found.");
        }

        synchronized (room.getLock()) {
            advanceRoomToNow(room, now);
            PlayerState player = room.getPlayers().get(playerId);
            if (player == null) {
                return CommandOutcome.rejected(roomId, playerId, "SESSION_NOT_AUTHORIZED", "Rejoin the room to continue.");
            }

            player.setLastSeenAtMs(now);
            room.setLastInteractionAtMs(now);

            if (room.getRoomCreatorPlayerId() != null && !room.getRoomCreatorPlayerId().equals(player.getPlayerId())) {
                return CommandOutcome.rejected(
                    roomId,
                    playerId,
                    buildStateUpdate(room, now),
                    "ROOM_CREATOR_ONLY",
                    "Only the room creator can change teacher setup."
                );
            }

            if (!PHASE_LOBBY.equals(room.getRacePhase())) {
                return CommandOutcome.rejected(
                    roomId,
                    playerId,
                    buildStateUpdate(room, now),
                    "ROOM_SETTINGS_LOCKED",
                    "Teacher setup can only be edited while the room is in the lobby."
                );
            }

            room.setRoomCreatorPlayerId(room.getRoomCreatorPlayerId() == null ? player.getPlayerId() : room.getRoomCreatorPlayerId());
            room.setRoomSettings(normalizeRoomSettings(
                room.getRoomId(),
                request.roomSettings(),
                Math.max(MIN_MAX_PLAYERS, room.getPlayers().size())
            ));
            return CommandOutcome.accepted(roomId, playerId, buildStateUpdate(room, now), null, null);
        }
    }

    public TickDispatch tickAndBuildUpdates(double deltaSeconds) {
        long now = System.currentTimeMillis();
        List<GameStateUpdateMessage> updates = new ArrayList<>();
        List<QuestionMessage> questionUpdates = new ArrayList<>();
        List<String> roomsToEvict = new ArrayList<>();

        for (GameRoomState room : rooms.values()) {
            synchronized (room.getLock()) {
                advanceRoomToNow(room, now);

                if (room.getPlayers().isEmpty()) {
                    if ((now - room.getLastInteractionAtMs()) >= EMPTY_ROOM_RETENTION_MS) {
                        roomsToEvict.add(room.getRoomId());
                    }
                    continue;
                }

                persistResultIfNeeded(room, now);
                updates.add(buildStateUpdate(room, now));
            }
        }

        for (String roomId : roomsToEvict) {
            rooms.remove(roomId);
        }

        return new TickDispatch(updates, questionUpdates);
    }

    public Collection<GameRoomState> getRooms() {
        return rooms.values();
    }

    public void markPlayerDisconnected(String roomId, String playerId) {
        String normalizedRoomId;
        String normalizedPlayerId;
        try {
            normalizedRoomId = normalizeExistingRoomId(roomId);
            normalizedPlayerId = normalizeExistingPlayerId(playerId);
        } catch (IllegalArgumentException ex) {
            return;
        }

        GameRoomState room = rooms.get(normalizedRoomId);
        if (room == null) {
            return;
        }

        synchronized (room.getLock()) {
            PlayerState player = room.getPlayers().get(normalizedPlayerId);
            if (player == null) {
                return;
            }
            player.setLastSeenAtMs(System.currentTimeMillis());
            room.setLastInteractionAtMs(System.currentTimeMillis());
        }
    }

    private PlayerState createPlayerState(String playerId, String displayName, int laneIndex) {
        return new PlayerState(playerId, displayName, laneIndex, BASE_SPEED_MPS);
    }

    private void advanceRoomToNow(GameRoomState room, long now) {
        pruneInactivePlayers(room, now);
        hydratePlayerRacePhases(room);
        hydrateRoomSetup(room);

        if (room.getPlayers().isEmpty()) {
            room.setRoomCreatorPlayerId(null);
            resetRoomForNewRace(room, now);
            room.setLastInteractionAtMs(now);
            return;
        }

        if (allPlayersInLobby(room) && !PHASE_LOBBY.equals(room.getRacePhase())) {
            resetRoomForNewRace(room, now);
            return;
        }

        if (!PHASE_LOBBY.equals(room.getRacePhase()) && !anyPlayersActivelyRacing(room) && anyPlayersWaitingInLobby(room)) {
            resetRoomForNewRace(room, now);
            return;
        }

        if (PHASE_LOBBY.equals(room.getRacePhase())) {
            room.setLastInteractionAtMs(now);
            return;
        }

        if (PHASE_STARTING.equals(room.getRacePhase())) {
            boolean anyoneStarting = room.getPlayers().values().stream().anyMatch(player -> PHASE_STARTING.equals(player.getRacePhase()));
            if (!anyoneStarting) {
                resetRoomForNewRace(room, now);
                return;
            }
            long startAtMs = room.getRaceStartingAtMs() > 0 ? room.getRaceStartingAtMs() : now;
            if (now < startAtMs) {
                room.setLastInteractionAtMs(now);
                return;
            }
            activateRace(room, startAtMs);
        }

        if (!PHASE_ACTIVE.equals(room.getRacePhase())) {
            room.setLastInteractionAtMs(now);
            return;
        }

        if (now <= room.getLastInteractionAtMs()) {
            room.setLastInteractionAtMs(now);
            return;
        }

        long cursor = room.getLastInteractionAtMs();
        long remainingMs = now - room.getLastInteractionAtMs();
        while (remainingMs > 0) {
            long stepMs = Math.min(remainingMs, MAX_ADVANCE_STEP_MS);
            long stepNow = cursor + stepMs;
            double delta = Math.max(0.01, stepMs / 1000.0);
            room.setTick(room.getTick() + 1L);

            FinishCandidate winnerCandidate = null;
            for (PlayerState player : room.getPlayers().values()) {
                FinishCandidate finishCandidate = updatePlayerMovement(room, player, delta, stepNow);
                if (finishCandidate != null) {
                    if (winnerCandidate == null
                        || finishCandidate.crossedAtMs() < winnerCandidate.crossedAtMs()
                        || (finishCandidate.crossedAtMs() == winnerCandidate.crossedAtMs()
                        && finishCandidate.player().getPlayerId().compareTo(winnerCandidate.player().getPlayerId()) < 0)) {
                        winnerCandidate = finishCandidate;
                    }
                }
                if (!room.isRaceStopped()) {
                    refreshExpiredQuestion(room, player, stepNow);
                    clearExpiredDecision(room, player, stepNow);
                }
            }

            if (!room.isRaceStopped() && winnerCandidate != null) {
                stopRace(room, winnerCandidate.player(), winnerCandidate.crossedAtMs());
            }

            cursor = stepNow;
            remainingMs -= stepMs;
        }

        room.setLastInteractionAtMs(now);
    }

    private void pruneInactivePlayers(GameRoomState room, long now) {
        List<String> stalePlayerIds = room
            .getPlayers()
            .values()
            .stream()
            .filter(player -> (now - player.getLastSeenAtMs()) > STALE_SESSION_MS)
            .map(PlayerState::getPlayerId)
            .toList();

        boolean removedWinner = false;
        boolean removedCreator = false;
        for (String playerId : stalePlayerIds) {
            PlayerState removed = room.getPlayers().remove(playerId);
            if (removed == null) {
                continue;
            }
            if (playerId.equals(room.getWinnerPlayerId())) {
                removedWinner = true;
            }
            if (playerId.equals(room.getRoomCreatorPlayerId())) {
                removedCreator = true;
            }
        }

        if (removedWinner) {
            room.setWinnerPlayerId(null);
        }
        if (removedCreator) {
            room.setRoomCreatorPlayerId(pickNextRoomCreator(room));
        }
        if (!stalePlayerIds.isEmpty()) {
            room.setRoomSettings(normalizeRoomSettings(
                room.getRoomId(),
                room.getRoomSettings(),
                Math.max(MIN_MAX_PLAYERS, room.getPlayers().size() == 0 ? MIN_MAX_PLAYERS : room.getPlayers().size())
            ));
        }
        rebalanceLanes(room);
    }

    private PromptBundle currentPrompt(GameRoomState room, PlayerState player, long now) {
        if (!PHASE_ACTIVE.equals(room.getRacePhase()) || room.isRaceStopped() || !PHASE_ACTIVE.equals(player.getRacePhase())) {
            return PromptBundle.empty();
        }

        DecisionPoint pendingDecision = player.getPendingDecisionPoint();
        if (pendingDecision != null && now <= pendingDecision.expiresAtMs()) {
            return new PromptBundle(
                null,
                new DecisionPointMessage(
                    room.getRoomId(),
                    player.getPlayerId(),
                    pendingDecision.eventId(),
                    pendingDecision.prompt(),
                    pendingDecision.options(),
                    pendingDecision.expiresAtMs()
                )
            );
        }

        PendingQuestion pendingQuestion = player.getPendingQuestion();
        if (pendingQuestion != null && now <= pendingQuestion.getExpiresAtMs()) {
            return new PromptBundle(toQuestionMessage(room.getRoomId(), player, pendingQuestion), null);
        }

        return PromptBundle.empty();
    }

    private void hydratePlayerRacePhases(GameRoomState room) {
        for (PlayerState player : room.getPlayers().values()) {
            player.setRacePhase(normalizeStoredPlayerRacePhase(player, room));
        }
    }

    private void hydrateRoomSetup(GameRoomState room) {
        room.setRoomSettings(normalizeRoomSettings(
            room.getRoomId(),
            room.getRoomSettings(),
            Math.max(MIN_MAX_PLAYERS, room.getPlayers().size() == 0 ? MIN_MAX_PLAYERS : room.getPlayers().size())
        ));
        if (room.getRoomCreatorPlayerId() == null || !room.getPlayers().containsKey(room.getRoomCreatorPlayerId())) {
            room.setRoomCreatorPlayerId(pickNextRoomCreator(room));
        }
    }

    private String pickNextRoomCreator(GameRoomState room) {
        return room.getPlayers().keySet().stream().sorted().findFirst().orElse(null);
    }

    private boolean allPlayersInLobby(GameRoomState room) {
        return !room.getPlayers().isEmpty()
            && room.getPlayers().values().stream().allMatch(player -> PHASE_LOBBY.equals(player.getRacePhase()));
    }

    private boolean anyPlayersActivelyRacing(GameRoomState room) {
        return room.getPlayers().values().stream().anyMatch(player ->
            PHASE_STARTING.equals(player.getRacePhase()) || PHASE_ACTIVE.equals(player.getRacePhase())
        );
    }

    private boolean anyPlayersWaitingInLobby(GameRoomState room) {
        return room.getPlayers().values().stream().anyMatch(player -> PHASE_LOBBY.equals(player.getRacePhase()));
    }

    private String normalizeStoredPlayerRacePhase(PlayerState player, GameRoomState room) {
        String racePhase = player.getRacePhase();
        if (PHASE_LOBBY.equals(racePhase) || PHASE_STARTING.equals(racePhase) || PHASE_ACTIVE.equals(racePhase) || PHASE_FINISH.equals(racePhase)) {
            return racePhase;
        }
        if (player.isFinished() || room.isRaceStopped() || PHASE_FINISH.equals(room.getRacePhase())) {
            return PHASE_FINISH;
        }
        if (PHASE_STARTING.equals(room.getRacePhase())) {
            return PHASE_STARTING;
        }
        if (PHASE_ACTIVE.equals(room.getRacePhase())) {
            return PHASE_ACTIVE;
        }
        return PHASE_LOBBY;
    }

    private void scheduleRaceStart(GameRoomState room, long now) {
        room.setResultPersisted(false);
        room.setPersistRetryAtMs(0L);
        room.setRacePhase(PHASE_STARTING);
        room.setRaceStartingAtMs(now + RACE_START_COUNTDOWN_MS);
        room.setRaceStopped(false);
        room.setRaceStartedAtMs(0L);
        room.setRaceStoppedAtMs(0L);
        room.setWinnerPlayerId(null);
        room.setTick(0L);
        room.setLastInteractionAtMs(now);

        for (PlayerState player : room.getPlayers().values()) {
            resetPlayerForNewRace(player);
            player.setRacePhase(PHASE_STARTING);
            player.setLastSeenAtMs(now);
        }
    }

    private void activateRace(GameRoomState room, long startAtMs) {
        room.setRacePhase(PHASE_ACTIVE);
        room.setRaceStartingAtMs(0L);
        room.setRaceStopped(false);
        room.setRaceStartedAtMs(startAtMs);
        room.setRaceStoppedAtMs(0L);
        room.setWinnerPlayerId(null);
        room.setTick(0L);
        room.setLastInteractionAtMs(startAtMs);

        for (PlayerState player : room.getPlayers().values()) {
            player.setRacePhase(PHASE_ACTIVE);
            player.setPendingDecisionPoint(null);
            player.setHighwayChallengeActive(false);
            if (!player.isFinished() && player.getPendingQuestion() == null) {
                issueNewQuestion(room, player, 1, false, startAtMs);
            }
        }
    }

    private void refreshExpiredQuestion(GameRoomState room, PlayerState player, long now) {
        if (room.isRaceStopped() || !PHASE_ACTIVE.equals(room.getRacePhase()) || !PHASE_ACTIVE.equals(player.getRacePhase())) {
            return;
        }
        PendingQuestion pending = player.getPendingQuestion();
        if (pending == null || now <= pending.getExpiresAtMs()) {
            return;
        }
        player.setCorrectStreak(0);
        player.setHighwayChallengeActive(false);
        player.setSpeedMps(Math.max(MIN_SPEED_MPS, player.getSpeedMps() - TIMEOUT_ANSWER_SPEED_PENALTY_MPS));
        issueNewQuestion(room, player, 1, false, now);
    }

    private void clearExpiredDecision(GameRoomState room, PlayerState player, long now) {
        if (room.isRaceStopped() || !PHASE_ACTIVE.equals(room.getRacePhase()) || !PHASE_ACTIVE.equals(player.getRacePhase())) {
            return;
        }
        DecisionPoint decisionPoint = player.getPendingDecisionPoint();
        if (decisionPoint == null || now <= decisionPoint.expiresAtMs()) {
            return;
        }
        player.setPendingDecisionPoint(null);
        player.setHighwayChallengeActive(false);
        if (player.getPendingQuestion() == null && !player.isFinished()) {
            issueNewQuestion(room, player, 1, false, now);
        }
    }

    private FinishCandidate updatePlayerMovement(GameRoomState room, PlayerState player, double dt, long now) {
        if (room.isRaceStopped() || player.isFinished() || !PHASE_ACTIVE.equals(player.getRacePhase())) {
            return null;
        }

        double safeDt = Double.isFinite(dt) ? Math.max(0D, dt) : 0.05D;
        double normalizedSpeed = Math.max(0D, sanitizeFinite(player.getSpeedMps(), player.getBaseSpeedMps()));
        player.setSpeedMps(normalizedSpeed);

        boolean boosted = now < player.getBoostUntilMs();
        double targetSpeed = boosted ? player.getBoostSpeedMps() : player.getBaseSpeedMps();
        targetSpeed = Math.max(0D, sanitizeFinite(targetSpeed, BASE_SPEED_MPS));
        if (!boosted) {
            player.setBoostSpeedMps(player.getBaseSpeedMps());
        }

        if (player.getSpeedMps() < targetSpeed) {
            double accel = boosted ? BOOST_ACCEL_MPS2 : BASE_ACCEL_MPS2;
            player.setSpeedMps(Math.min(targetSpeed, player.getSpeedMps() + accel * safeDt));
        } else if (player.getSpeedMps() > targetSpeed) {
            player.setSpeedMps(Math.max(targetSpeed, player.getSpeedMps() - DRAG_MPS2 * safeDt));
        }

        double trackLength = room.getTrackLengthMeters();
        double totalRaceDistance = room.getTotalLaps() * trackLength;
        int safeLap = Math.max(0, Math.min(room.getTotalLaps(), player.getLap()));
        double safePosition = Math.max(0D, Math.min(trackLength, sanitizeFinite(player.getPositionMeters(), 0D)));
        player.setLap(safeLap);
        player.setPositionMeters(safePosition);
        double currentDistance = (safeLap * trackLength) + safePosition;
        double travelDistance = Math.max(0D, player.getSpeedMps() * safeDt);
        double nextDistance = currentDistance + travelDistance;

        if (nextDistance >= totalRaceDistance) {
            player.setLap(room.getTotalLaps());
            player.setFinished(true);
            player.setPositionMeters(trackLength);
            player.setPendingQuestion(null);
            player.setPendingDecisionPoint(null);
            player.setHighwayChallengeActive(false);

            long tickWindowMs = Math.max(1L, Math.round(safeDt * 1000.0));
            double remainingDistance = Math.max(0D, totalRaceDistance - currentDistance);
            double ratioWithinTick = travelDistance > 0D ? Math.min(1D, remainingDistance / travelDistance) : 1D;
            long crossedAtMs = now - tickWindowMs + Math.round(ratioWithinTick * tickWindowMs);
            return new FinishCandidate(player, crossedAtMs);
        }

        int lap = (int) Math.floor(nextDistance / trackLength);
        double lapStart = lap * trackLength;
        double positionMeters = nextDistance - lapStart;
        player.setLap(lap);
        player.setPositionMeters(positionMeters);
        return null;
    }

    private void stopRace(GameRoomState room, PlayerState winner, long now) {
        if (room.isRaceStopped()) {
            return;
        }

        room.setRacePhase(PHASE_FINISH);
        room.setRaceStartingAtMs(0L);
        room.setRaceStopped(true);
        room.setRaceStoppedAtMs(now);
        room.setWinnerPlayerId(winner.getPlayerId());
        room.setLastInteractionAtMs(now);

        for (PlayerState player : room.getPlayers().values()) {
            if (PHASE_ACTIVE.equals(player.getRacePhase()) || PHASE_STARTING.equals(player.getRacePhase())) {
                player.setRacePhase(PHASE_FINISH);
            }
            player.setSpeedMps(0D);
            player.setBoostUntilMs(0L);
            player.setBoostSpeedMps(player.getBaseSpeedMps());
            player.setPendingQuestion(null);
            player.setPendingDecisionPoint(null);
            player.setHighwayChallengeActive(false);
        }
    }

    private void resetPlayerForNewRace(PlayerState player) {
        player.setPositionMeters(0D);
        player.setSpeedMps(BASE_SPEED_MPS);
        player.setBaseSpeedMps(BASE_SPEED_MPS);
        player.setBoostSpeedMps(BASE_SPEED_MPS);
        player.setBoostUntilMs(0L);
        player.setLap(0);
        player.setFinished(false);
        player.setCorrectStreak(0);
        player.setPendingQuestion(null);
        player.setPendingDecisionPoint(null);
        player.setDecisionCooldownUntilMs(0L);
        player.setHighwayChallengeActive(false);
        player.setRacePhase(PHASE_LOBBY);
    }

    private void resetRoomForNewRace(GameRoomState room, long now) {
        room.setRacePhase(PHASE_LOBBY);
        room.setRaceStartingAtMs(0L);
        room.setRaceStopped(false);
        room.setRaceStartedAtMs(0L);
        room.setRaceStoppedAtMs(0L);
        room.setWinnerPlayerId(null);
        room.setResultPersisted(false);
        room.setPersistRetryAtMs(0L);
        room.setTick(0L);
        room.setLastInteractionAtMs(now);
        for (PlayerState player : room.getPlayers().values()) {
            resetPlayerForNewRace(player);
        }
    }

    private void issueNewQuestion(GameRoomState room, PlayerState player, int difficulty, boolean highwayChallenge, long now) {
        GeneratedQuestion baseQuestion = questionGeneratorService.generateQuestion(difficulty);
        int timeLimitMs = Math.max(
            MIN_QUESTION_TIME_LIMIT_SECONDS * 1000,
            room.getRoomSettings().questionTimeLimitSeconds() * 1000
        );
        GeneratedQuestion generated = new GeneratedQuestion(
            baseQuestion.questionId(),
            baseQuestion.prompt(),
            baseQuestion.correctAnswer(),
            baseQuestion.difficulty(),
            timeLimitMs,
            baseQuestion.boostMultiplier()
        );
        PendingQuestion pending = new PendingQuestion(generated, now + generated.timeLimitMs(), highwayChallenge);
        player.setPendingQuestion(pending);
    }

    private DecisionPointMessage issueDecision(GameRoomState room, PlayerState player, long now) {
        DecisionPoint point = new DecisionPoint(
            UUID.randomUUID().toString(),
            "Choose route: HIGHWAY (hard question, huge boost) or DIRT (safe bonus).",
            List.of("HIGHWAY", "DIRT"),
            now + DECISION_TTL_MS
        );
        player.setPendingDecisionPoint(point);
        return new DecisionPointMessage(
            room.getRoomId(),
            player.getPlayerId(),
            point.eventId(),
            point.prompt(),
            point.options(),
            point.expiresAtMs()
        );
    }

    private boolean shouldOfferDecision(PlayerState player, long now) {
        if (player.getPendingDecisionPoint() != null || player.isHighwayChallengeActive()) {
            return false;
        }
        if (now < player.getDecisionCooldownUntilMs()) {
            return false;
        }
        return ThreadLocalRandom.current().nextDouble() < DECISION_TRIGGER_PROBABILITY;
    }

    private int calculateDifficulty(PlayerState player, boolean correctAnswer) {
        int levelByStreak = 1 + Math.min(2, player.getCorrectStreak() / 2);
        if (player.getLap() >= 2) {
            levelByStreak = Math.min(3, levelByStreak + 1);
        }
        if (!correctAnswer) {
            levelByStreak = Math.max(1, levelByStreak - 1);
        }
        return levelByStreak;
    }

    private void applyBoost(PlayerState player, double multiplier, long durationMs, long now) {
        double cappedMultiplier = Math.max(0.35, Math.min(multiplier, 2.5));
        double boostSpeed = player.getBaseSpeedMps() + (BOOST_EXTRA_SPEED_MPS * cappedMultiplier);
        player.setBoostSpeedMps(Math.max(player.getBoostSpeedMps(), boostSpeed));
        player.setBoostUntilMs(Math.max(player.getBoostUntilMs(), now + durationMs));
    }

    private GameStateUpdateMessage buildStateUpdate(GameRoomState room, long now) {
        double trackLength = room.getTrackLengthMeters();
        int totalLaps = room.getTotalLaps();
        List<PlayerSnapshot> players = room
            .getPlayers()
            .values()
            .stream()
            .sorted(
                Comparator
                    .comparingInt(PlayerState::getLap)
                    .reversed()
                    .thenComparing(Comparator.comparingDouble(PlayerState::getPositionMeters).reversed())
                    .thenComparing(PlayerState::getPlayerId)
            )
            .map(player -> {
                int safeLap = Math.max(0, Math.min(totalLaps, player.getLap()));
                int safeLaneIndex = Math.max(0, Math.min(3, player.getLaneIndex()));
                double safePosition = sanitizeFinite(player.getPositionMeters(), 0D);
                safePosition = Math.max(0D, Math.min(trackLength, safePosition));
                if (player.isFinished()) {
                    safePosition = trackLength;
                }
                double safeSpeed = Math.max(0D, sanitizeFinite(player.getSpeedMps(), 0D));
                return new PlayerSnapshot(
                    player.getPlayerId(),
                    player.getDisplayName(),
                    safeLaneIndex,
                    round(safePosition),
                    round(safeSpeed),
                    safeLap,
                    player.isFinished(),
                    normalizeStoredPlayerRacePhase(player, room)
                );
            })
            .toList();

        return new GameStateUpdateMessage(
            room.getRoomId(),
            now,
            room.getTick(),
            room.getRacePhase(),
            room.getRaceStartingAtMs(),
            room.getRaceStartedAtMs(),
            room.isRaceStopped(),
            room.getRaceStoppedAtMs(),
            room.getWinnerPlayerId(),
            room.getRoomCreatorPlayerId() == null ? "" : room.getRoomCreatorPlayerId(),
            room.getRoomSettings(),
            players
        );
    }

    private RoomJoinedMessage buildJoinMessage(GameRoomState room, PlayerState player) {
        return new RoomJoinedMessage(
            room.getRoomId(),
            player.getPlayerId(),
            player.getDisplayName(),
            room.getTrackLengthMeters(),
            room.getTotalLaps(),
            BASE_SPEED_MPS,
            room.getRoomCreatorPlayerId() == null ? player.getPlayerId() : room.getRoomCreatorPlayerId(),
            room.getRoomSettings()
        );
    }

    private QuestionMessage toQuestionMessage(String roomId, PlayerState player, PendingQuestion pendingQuestion) {
        return new QuestionMessage(
            roomId,
            player.getPlayerId(),
            pendingQuestion.getQuestion().questionId(),
            pendingQuestion.getQuestion().prompt(),
            pendingQuestion.getQuestion().difficulty(),
            pendingQuestion.getQuestion().timeLimitMs(),
            pendingQuestion.getExpiresAtMs(),
            pendingQuestion.isFromHighwayChallenge()
        );
    }

    private void persistResultIfNeeded(GameRoomState room, long now) {
        if (room.isResultPersisted() || !room.isRaceStopped() || now < room.getPersistRetryAtMs()) {
            return;
        }

        PlayerState winner = null;
        if (room.getWinnerPlayerId() != null) {
            winner = room.getPlayers().get(room.getWinnerPlayerId());
        }
        if (winner == null) {
            winner = room.getPlayers().values().stream().filter(PlayerState::isFinished).findFirst().orElse(null);
        }
        if (winner == null) {
            return;
        }

        try {
            raceHistoryService.recordRoomResult(room, winner);
            room.setResultPersisted(true);
            room.setPersistRetryAtMs(0L);
        } catch (RuntimeException ex) {
            room.setPersistRetryAtMs(now + RESULT_PERSIST_RETRY_MS);
            log.warn("Could not persist race result for roomId={}", room.getRoomId(), ex);
        }
    }

    private void saveUserProfile(String playerId, String displayName) {
        try {
            UserProfile profile = userProfileStore.findById(playerId).orElseGet(UserProfile::new);
            profile.setId(playerId);
            profile.setDisplayName(displayName);
            userProfileStore.save(profile);
        } catch (RuntimeException ex) {
            log.warn("Could not save user profile for playerId={}", playerId, ex);
        }
    }

    private static void rebalanceLanes(GameRoomState room) {
        List<PlayerState> ordered = room
            .getPlayers()
            .values()
            .stream()
            .sorted(Comparator.comparing(PlayerState::getPlayerId))
            .toList();
        for (int index = 0; index < ordered.size(); index += 1) {
            ordered.get(index).setLaneIndex(index % 4);
        }
    }

    private RoomSettings normalizeRoomSettings(String roomId, RoomSettings roomSettings, int minimumPlayers) {
        RoomSettings defaults = buildDefaultRoomSettings(roomId);
        int safeMinimumPlayers = Math.max(MIN_MAX_PLAYERS, Math.min(MAX_MAX_PLAYERS, minimumPlayers));
        String raceName = roomSettings == null || roomSettings.raceName() == null || roomSettings.raceName().trim().isBlank()
            ? defaults.raceName()
            : roomSettings.raceName().trim();
        if (raceName.length() > 80) {
            raceName = raceName.substring(0, 80);
        }

        return new RoomSettings(
            raceName,
            clampInt(roomSettings == null ? defaults.maxPlayers() : roomSettings.maxPlayers(), defaults.maxPlayers(), safeMinimumPlayers, MAX_MAX_PLAYERS),
            clampInt(roomSettings == null ? defaults.raceDurationSeconds() : roomSettings.raceDurationSeconds(), defaults.raceDurationSeconds(), MIN_RACE_DURATION_SECONDS, MAX_RACE_DURATION_SECONDS),
            clampInt(roomSettings == null ? defaults.questionTimeLimitSeconds() : roomSettings.questionTimeLimitSeconds(), defaults.questionTimeLimitSeconds(), MIN_QUESTION_TIME_LIMIT_SECONDS, MAX_QUESTION_TIME_LIMIT_SECONDS)
        );
    }

    private RoomSettings buildDefaultRoomSettings(String roomId) {
        String safeRoomId = roomId == null ? "" : roomId.trim();
        String defaultRaceName = safeRoomId.isBlank()
            ? "Classroom Race"
            : safeRoomId.replaceAll("[-_]+", " ") + " setup";
        return new RoomSettings(
            defaultRaceName,
            DEFAULT_MAX_PLAYERS,
            DEFAULT_RACE_DURATION_SECONDS,
            DEFAULT_QUESTION_TIME_LIMIT_SECONDS
        );
    }

    private static int clampInt(int value, int fallback, int min, int max) {
        if (min > max) {
            return fallback;
        }
        return Math.max(min, Math.min(max, value));
    }

    private static String normalizeRoomId(String roomId) {
        return GameInputValidator.normalizeRoomId(roomId, true);
    }

    private static String normalizeExistingRoomId(String roomId) {
        return GameInputValidator.normalizeRoomId(roomId, false);
    }

    private static String normalizePlayerId(String playerId) {
        return GameInputValidator.normalizePlayerId(playerId, true);
    }

    private static String normalizeExistingPlayerId(String playerId) {
        return GameInputValidator.normalizePlayerId(playerId, false);
    }

    private static String normalizeDisplayName(String displayName, String playerId) {
        return GameInputValidator.normalizeDisplayName(displayName, playerId);
    }

    private static double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    private static double sanitizeFinite(double value, double fallback) {
        return Double.isFinite(value) ? value : fallback;
    }

    public record JoinOutcome(
        boolean accepted,
        RoomJoinedMessage joinedMessage,
        GameStateUpdateMessage stateUpdate,
        QuestionMessage question,
        DecisionPointMessage decision,
        String errorCode,
        String errorMessage
    ) {
        public static JoinOutcome accepted(
            RoomJoinedMessage joinedMessage,
            GameStateUpdateMessage stateUpdate,
            QuestionMessage question,
            DecisionPointMessage decision
        ) {
            return new JoinOutcome(true, joinedMessage, stateUpdate, question, decision, null, null);
        }

        public static JoinOutcome rejected(String roomId, String playerId, String errorCode, String errorMessage) {
            return new JoinOutcome(false, null, null, null, null, errorCode, errorMessage);
        }
    }

    public record CommandOutcome(
        String roomId,
        String playerId,
        boolean accepted,
        GameStateUpdateMessage stateUpdate,
        QuestionMessage question,
        DecisionPointMessage decision,
        String errorCode,
        String errorMessage
    ) {
        public static CommandOutcome accepted(
            String roomId,
            String playerId,
            GameStateUpdateMessage stateUpdate,
            QuestionMessage question,
            DecisionPointMessage decision
        ) {
            return new CommandOutcome(roomId, playerId, true, stateUpdate, question, decision, null, null);
        }

        public static CommandOutcome rejected(String roomId, String playerId, String errorCode, String errorMessage) {
            return new CommandOutcome(roomId, playerId, false, null, null, null, errorCode, errorMessage);
        }

        public static CommandOutcome rejected(
            String roomId,
            String playerId,
            GameStateUpdateMessage stateUpdate,
            String errorCode,
            String errorMessage
        ) {
            return new CommandOutcome(roomId, playerId, false, stateUpdate, null, null, errorCode, errorMessage);
        }
    }

    public record AnswerOutcome(
        String roomId,
        String playerId,
        boolean accepted,
        boolean correct,
        GameStateUpdateMessage stateUpdate,
        QuestionMessage question,
        DecisionPointMessage decision,
        String errorCode,
        String errorMessage
    ) {
        public static AnswerOutcome accepted(
            String roomId,
            String playerId,
            boolean correct,
            GameStateUpdateMessage stateUpdate,
            QuestionMessage question,
            DecisionPointMessage decision
        ) {
            return new AnswerOutcome(roomId, playerId, true, correct, stateUpdate, question, decision, null, null);
        }

        public static AnswerOutcome rejected(
            String roomId,
            String playerId,
            boolean correct,
            String errorCode,
            String errorMessage
        ) {
            return new AnswerOutcome(roomId, playerId, false, correct, null, null, null, errorCode, errorMessage);
        }

        public AnswerOutcome withState(GameStateUpdateMessage nextStateUpdate) {
            return new AnswerOutcome(roomId, playerId, accepted, correct, nextStateUpdate, question, decision, errorCode, errorMessage);
        }

        public AnswerOutcome withQuestion(QuestionMessage nextQuestion) {
            return new AnswerOutcome(roomId, playerId, accepted, correct, stateUpdate, nextQuestion, decision, errorCode, errorMessage);
        }

        public AnswerOutcome withDecision(DecisionPointMessage nextDecision) {
            return new AnswerOutcome(roomId, playerId, accepted, correct, stateUpdate, question, nextDecision, errorCode, errorMessage);
        }
    }

    public record DecisionOutcome(
        String roomId,
        String playerId,
        boolean accepted,
        GameStateUpdateMessage stateUpdate,
        QuestionMessage nextQuestion,
        String errorCode,
        String errorMessage
    ) {
        public static DecisionOutcome accepted(
            String roomId,
            String playerId,
            GameStateUpdateMessage stateUpdate,
            QuestionMessage nextQuestion
        ) {
            return new DecisionOutcome(roomId, playerId, true, stateUpdate, nextQuestion, null, null);
        }

        public static DecisionOutcome rejected(
            String roomId,
            String playerId,
            String errorCode,
            String errorMessage
        ) {
            return new DecisionOutcome(roomId, playerId, false, null, null, errorCode, errorMessage);
        }

        public DecisionOutcome withState(GameStateUpdateMessage nextStateUpdate) {
            return new DecisionOutcome(roomId, playerId, accepted, nextStateUpdate, nextQuestion, errorCode, errorMessage);
        }

        public DecisionOutcome withQuestion(QuestionMessage questionMessage) {
            return new DecisionOutcome(roomId, playerId, accepted, stateUpdate, questionMessage, errorCode, errorMessage);
        }
    }

    public record TickDispatch(
        List<GameStateUpdateMessage> stateUpdates,
        List<QuestionMessage> questionUpdates
    ) {
    }

    private record PromptBundle(
        QuestionMessage question,
        DecisionPointMessage decision
    ) {
        private static PromptBundle empty() {
            return new PromptBundle(null, null);
        }
    }

    private record FinishCandidate(
        PlayerState player,
        long crossedAtMs
    ) {
    }
}
