package com.asphalt8.backend.service;

import com.asphalt8.backend.entity.UserProfile;
import com.asphalt8.backend.game.dto.AnswerSubmissionRequest;
import com.asphalt8.backend.game.dto.DecisionChoiceRequest;
import com.asphalt8.backend.game.dto.DecisionPointMessage;
import com.asphalt8.backend.game.dto.GameStateUpdateMessage;
import com.asphalt8.backend.game.dto.JoinRoomRequest;
import com.asphalt8.backend.game.dto.PlayerSnapshot;
import com.asphalt8.backend.game.dto.QuestionMessage;
import com.asphalt8.backend.game.dto.RoomJoinedMessage;
import com.asphalt8.backend.game.model.DecisionPoint;
import com.asphalt8.backend.game.model.GameRoomState;
import com.asphalt8.backend.game.model.PendingQuestion;
import com.asphalt8.backend.game.model.PlayerState;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
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

    // Movement and boost tuning for responsive finish-line based races.
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
    private static final long DECISION_COOLDOWN_MS = 12000L;
    private static final long DECISION_TTL_MS = 8000L;
    private static final double HIGHWAY_TELEPORT_METERS = 240.0;
    private static final long HIGHWAY_SUPER_BOOST_MS = 2200L;
    private static final long EMPTY_ROOM_RETENTION_MS = 120_000L;
    private static final long RESULT_PERSIST_RETRY_MS = 5000L;

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
        saveUserProfile(playerId, displayName);

        GameRoomState room = rooms.computeIfAbsent(
            roomId,
            id -> new GameRoomState(id, configuredTrackLengthMeters, configuredTotalLaps)
        );

        List<QuestionMessage> questionMessages = new ArrayList<>();
        boolean raceRestarted = false;
        GameStateUpdateMessage immediateStateUpdate;

        synchronized (room.getLock()) {
            long now = System.currentTimeMillis();
            room.setLastInteractionAtMs(now);

            if (room.isRaceStopped()) {
                resetRoomForNewRace(room, now);
                raceRestarted = true;
            }

            PlayerState player = room.getPlayers().get(playerId);
            if (player == null) {
                int laneIndex = room.getPlayers().size() % 4;
                player = new PlayerState(playerId, displayName, laneIndex, BASE_SPEED_MPS);
                room.getPlayers().put(playerId, player);
            } else {
                player.setDisplayName(displayName);
                if (player.isFinished()) {
                    resetPlayerForNewRace(player);
                    room.setResultPersisted(false);
                }
            }

            if (raceRestarted) {
                issueQuestionsForAllPlayers(room, now, questionMessages);
            } else {
                DecisionPoint pendingDecision = player.getPendingDecisionPoint();
                if (pendingDecision != null && now > pendingDecision.expiresAtMs()) {
                    player.setPendingDecisionPoint(null);
                }

                PendingQuestion pendingQuestion = player.getPendingQuestion();
                boolean noPendingQuestion = pendingQuestion == null;
                boolean pendingQuestionExpired = pendingQuestion != null && now > pendingQuestion.getExpiresAtMs();

                if (noPendingQuestion || pendingQuestionExpired) {
                    issueNewQuestion(player, 1, false, now);
                }
                if (player.getPendingQuestion() != null) {
                    questionMessages.add(toQuestionMessage(room.getRoomId(), player, player.getPendingQuestion()));
                }
            }

            immediateStateUpdate = buildStateUpdate(room, now);
        }

        RoomJoinedMessage joinedMessage = new RoomJoinedMessage(
            roomId,
            playerId,
            displayName,
            room.getTrackLengthMeters(),
            room.getTotalLaps(),
            BASE_SPEED_MPS
        );
        return new JoinOutcome(joinedMessage, questionMessages, raceRestarted, immediateStateUpdate);
    }

    public Optional<QuestionMessage> getCurrentQuestion(String roomId, String playerId) {
        String normalizedRoomId;
        String normalizedPlayerId;
        try {
            normalizedRoomId = normalizeExistingRoomId(roomId);
            normalizedPlayerId = normalizeExistingPlayerId(playerId);
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }

        GameRoomState room = rooms.get(normalizedRoomId);
        if (room == null) {
            return Optional.empty();
        }

        synchronized (room.getLock()) {
            if (room.isRaceStopped()) {
                return Optional.empty();
            }
            PlayerState player = room.getPlayers().get(normalizedPlayerId);
            if (player == null || player.getPendingQuestion() == null) {
                return Optional.empty();
            }
            return Optional.of(toQuestionMessage(room.getRoomId(), player, player.getPendingQuestion()));
        }
    }

    public AnswerOutcome submitAnswer(AnswerSubmissionRequest request) {
        String normalizedRoomId;
        String normalizedPlayerId;
        try {
            normalizedRoomId = normalizeExistingRoomId(request.roomId());
            normalizedPlayerId = normalizeExistingPlayerId(request.playerId());
        } catch (IllegalArgumentException ex) {
            return AnswerOutcome.rejected(null, null, false);
        }

        GameRoomState room = rooms.get(normalizedRoomId);
        if (room == null) {
            return AnswerOutcome.rejected(normalizedRoomId, normalizedPlayerId, false);
        }

        synchronized (room.getLock()) {
            long now = System.currentTimeMillis();
            room.setLastInteractionAtMs(now);

            PlayerState player = room.getPlayers().get(normalizedPlayerId);
            if (player == null || player.isFinished() || room.isRaceStopped()) {
                return AnswerOutcome.rejected(normalizedRoomId, normalizedPlayerId, false);
            }

            DecisionPoint activeDecision = player.getPendingDecisionPoint();
            if (activeDecision != null && now <= activeDecision.expiresAtMs()) {
                return AnswerOutcome.rejected(room.getRoomId(), player.getPlayerId(), false);
            }
            if (activeDecision != null && now > activeDecision.expiresAtMs()) {
                player.setPendingDecisionPoint(null);
            }

            PendingQuestion pending = player.getPendingQuestion();
            if (pending == null) {
                issueNewQuestion(player, 1, false, now);
                return AnswerOutcome.rejected(room.getRoomId(), player.getPlayerId(), false)
                    .withQuestion(toQuestionMessage(room.getRoomId(), player, player.getPendingQuestion()));
            }

            boolean expectedQuestion = pending.getQuestion().questionId().equals(request.questionId());
            if (!expectedQuestion) {
                return AnswerOutcome.rejected(room.getRoomId(), player.getPlayerId(), false)
                    .withQuestion(toQuestionMessage(room.getRoomId(), player, pending));
            }

            boolean notExpired = now <= (pending.getExpiresAtMs() + ANSWER_GRACE_MS);
            boolean correct = notExpired && isCorrectAnswer(request.answer(), pending.getQuestion().correctAnswer());

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

            if (correct && shouldOfferDecision(player, now)) {
                DecisionPointMessage decision = issueDecision(room, player, now);
                return new AnswerOutcome(room.getRoomId(), player.getPlayerId(), true, true, null, decision);
            }

            int nextDifficulty = calculateDifficulty(player, correct);
            issueNewQuestion(player, nextDifficulty, false, now);
            QuestionMessage nextQuestion = toQuestionMessage(room.getRoomId(), player, player.getPendingQuestion());
            return new AnswerOutcome(room.getRoomId(), player.getPlayerId(), true, correct, nextQuestion, null);
        }
    }

    public DecisionOutcome chooseDecision(DecisionChoiceRequest request) {
        String normalizedRoomId;
        String normalizedPlayerId;
        try {
            normalizedRoomId = normalizeExistingRoomId(request.roomId());
            normalizedPlayerId = normalizeExistingPlayerId(request.playerId());
        } catch (IllegalArgumentException ex) {
            return DecisionOutcome.rejected(null, null);
        }

        GameRoomState room = rooms.get(normalizedRoomId);
        if (room == null) {
            return DecisionOutcome.rejected(normalizedRoomId, normalizedPlayerId);
        }

        synchronized (room.getLock()) {
            long now = System.currentTimeMillis();
            room.setLastInteractionAtMs(now);

            PlayerState player = room.getPlayers().get(normalizedPlayerId);
            if (player == null || player.isFinished() || room.isRaceStopped()) {
                return DecisionOutcome.rejected(normalizedRoomId, normalizedPlayerId);
            }

            DecisionPoint point = player.getPendingDecisionPoint();
            if (point == null) {
                if (player.getPendingQuestion() == null) {
                    issueNewQuestion(player, 1, false, now);
                }
                QuestionMessage fallback = player.getPendingQuestion() == null
                    ? null
                    : toQuestionMessage(room.getRoomId(), player, player.getPendingQuestion());
                return DecisionOutcome.rejected(room.getRoomId(), player.getPlayerId()).withQuestion(fallback);
            }

            if (!point.eventId().equals(request.eventId())) {
                return DecisionOutcome.rejected(room.getRoomId(), player.getPlayerId());
            }

            if (now > point.expiresAtMs()) {
                player.setPendingDecisionPoint(null);
                if (player.getPendingQuestion() == null) {
                    issueNewQuestion(player, 1, false, now);
                }
                QuestionMessage fallback = player.getPendingQuestion() == null
                    ? null
                    : toQuestionMessage(room.getRoomId(), player, player.getPendingQuestion());
                return DecisionOutcome.rejected(room.getRoomId(), player.getPlayerId()).withQuestion(fallback);
            }

            player.setPendingDecisionPoint(null);
            player.setDecisionCooldownUntilMs(now + DECISION_COOLDOWN_MS);

            String choice = request.choice() == null ? "" : request.choice().trim().toUpperCase();
            if ("HIGHWAY".equals(choice)) {
                player.setHighwayChallengeActive(true);
                issueNewQuestion(player, 3, true, now);
            } else if ("DIRT".equals(choice)) {
                player.setHighwayChallengeActive(false);
                applyBoost(player, 0.60, 1600L, now);
                issueNewQuestion(player, Math.max(1, calculateDifficulty(player, true) - 1), false, now);
            } else {
                player.setPendingDecisionPoint(point);
                return DecisionOutcome.rejected(room.getRoomId(), player.getPlayerId());
            }

            return new DecisionOutcome(
                room.getRoomId(),
                player.getPlayerId(),
                true,
                toQuestionMessage(room.getRoomId(), player, player.getPendingQuestion())
            );
        }
    }

    public TickDispatch tickAndBuildUpdates(double deltaSeconds) {
        long now = System.currentTimeMillis();
        List<GameStateUpdateMessage> updates = new ArrayList<>();
        List<QuestionMessage> questionUpdates = new ArrayList<>();
        List<Map.Entry<String, GameRoomState>> roomsToEvict = new ArrayList<>();

        for (Map.Entry<String, GameRoomState> roomEntry : rooms.entrySet()) {
            GameRoomState room = roomEntry.getValue();
            synchronized (room.getLock()) {
                if (room.getPlayers().isEmpty()) {
                    if ((now - room.getLastInteractionAtMs()) >= EMPTY_ROOM_RETENTION_MS) {
                        roomsToEvict.add(roomEntry);
                    }
                    continue;
                }

                room.setTick(room.getTick() + 1);
                List<FinishCandidate> finishCandidates = new ArrayList<>();
                for (PlayerState player : room.getPlayers().values()) {
                    FinishCandidate finishCandidate = updatePlayerMovement(room, player, deltaSeconds, now);
                    if (finishCandidate != null) {
                        finishCandidates.add(finishCandidate);
                    }
                    if (!room.isRaceStopped()) {
                        QuestionMessage expiredQuestionRefresh = refreshExpiredQuestion(room, player, now);
                        if (expiredQuestionRefresh != null) {
                            questionUpdates.add(expiredQuestionRefresh);
                        }

                        QuestionMessage expiredDecisionFallback = clearExpiredDecision(room, player, now);
                        if (expiredDecisionFallback != null) {
                            questionUpdates.add(expiredDecisionFallback);
                        }
                    }
                }

                if (!room.isRaceStopped() && !finishCandidates.isEmpty()) {
                    FinishCandidate winner = finishCandidates
                        .stream()
                        .sorted(
                            Comparator
                                .comparingLong(FinishCandidate::crossedAtMs)
                                .thenComparing(candidate -> candidate.player().getPlayerId())
                        )
                        .findFirst()
                        .orElse(null);
                    if (winner != null) {
                        stopRace(room, winner.player(), winner.crossedAtMs());
                    }
                }

                persistResultIfNeeded(room, now);
                updates.add(buildStateUpdate(room, now));
            }
        }

        for (Map.Entry<String, GameRoomState> roomEntry : roomsToEvict) {
            rooms.remove(roomEntry.getKey(), roomEntry.getValue());
        }

        return new TickDispatch(updates, questionUpdates);
    }

    public Collection<GameRoomState> getRooms() {
        return rooms.values();
    }

    public void removePlayerFromRoom(String roomId, String playerId) {
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
            PlayerState removed = room.getPlayers().remove(normalizedPlayerId);
            if (removed == null) {
                return;
            }

            room.setLastInteractionAtMs(System.currentTimeMillis());
            if (room.getPlayers().isEmpty()) {
                rooms.remove(normalizedRoomId, room);
                return;
            }

            if (normalizedPlayerId.equals(room.getWinnerPlayerId())) {
                room.setWinnerPlayerId(null);
            }

            rebalanceLanes(room);
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

    private QuestionMessage refreshExpiredQuestion(GameRoomState room, PlayerState player, long now) {
        if (room.isRaceStopped()) {
            return null;
        }
        PendingQuestion pending = player.getPendingQuestion();
        if (pending == null || now <= pending.getExpiresAtMs()) {
            return null;
        }
        player.setCorrectStreak(0);
        player.setHighwayChallengeActive(false);
        player.setSpeedMps(Math.max(MIN_SPEED_MPS, player.getSpeedMps() - TIMEOUT_ANSWER_SPEED_PENALTY_MPS));
        issueNewQuestion(player, 1, false, now);
        return toQuestionMessage(room.getRoomId(), player, player.getPendingQuestion());
    }

    private QuestionMessage clearExpiredDecision(GameRoomState room, PlayerState player, long now) {
        if (room.isRaceStopped()) {
            return null;
        }
        DecisionPoint decisionPoint = player.getPendingDecisionPoint();
        if (decisionPoint == null || now <= decisionPoint.expiresAtMs()) {
            return null;
        }

        player.setPendingDecisionPoint(null);
        player.setHighwayChallengeActive(false);

        if (player.getPendingQuestion() == null && !player.isFinished()) {
            issueNewQuestion(player, 1, false, now);
            return toQuestionMessage(room.getRoomId(), player, player.getPendingQuestion());
        }
        return null;
    }

    private FinishCandidate updatePlayerMovement(GameRoomState room, PlayerState player, double dt, long now) {
        if (room.isRaceStopped() || player.isFinished()) {
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

    private void persistResultIfNeeded(GameRoomState room, long now) {
        if (room.isResultPersisted() || now < room.getPersistRetryAtMs()) {
            return;
        }

        PlayerState winner = null;
        if (room.getWinnerPlayerId() != null) {
            winner = room.getPlayers().get(room.getWinnerPlayerId());
        }
        if (winner == null) {
            Optional<PlayerState> fallbackWinner = room
                .getPlayers()
                .values()
                .stream()
                .filter(PlayerState::isFinished)
                .findFirst();
            winner = fallbackWinner.orElse(null);
        }

        if (winner != null) {
            try {
                raceHistoryService.recordRoomResult(room, winner);
                room.setResultPersisted(true);
                room.setPersistRetryAtMs(0L);
            } catch (RuntimeException ex) {
                room.setPersistRetryAtMs(now + RESULT_PERSIST_RETRY_MS);
                log.warn("Could not persist race result for roomId={}", room.getRoomId(), ex);
            }
        }
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
                double safePosition = sanitizeFinite(player.getPositionMeters(), 0D);
                safePosition = Math.max(0D, Math.min(trackLength, safePosition));
                if (player.isFinished()) {
                    safePosition = trackLength;
                }
                double safeSpeed = Math.max(0D, sanitizeFinite(player.getSpeedMps(), 0D));

                return new PlayerSnapshot(
                    player.getPlayerId(),
                    player.getDisplayName(),
                    player.getLaneIndex(),
                    round(safePosition),
                    round(safeSpeed),
                    safeLap,
                    player.isFinished()
                );
            })
            .toList();

        return new GameStateUpdateMessage(
            room.getRoomId(),
            now,
            room.getTick(),
            room.getRaceStartedAtMs(),
            room.isRaceStopped(),
            room.getRaceStoppedAtMs(),
            room.getWinnerPlayerId(),
            players
        );
    }

    private void stopRace(GameRoomState room, PlayerState winner, long now) {
        if (room.isRaceStopped()) {
            return;
        }

        room.setLastInteractionAtMs(now);
        room.setRaceStopped(true);
        room.setRaceStoppedAtMs(now);
        room.setWinnerPlayerId(winner.getPlayerId());

        for (PlayerState player : room.getPlayers().values()) {
            player.setSpeedMps(0D);
            player.setBoostUntilMs(0L);
            player.setBoostSpeedMps(player.getBaseSpeedMps());
            player.setPendingQuestion(null);
            player.setPendingDecisionPoint(null);
            player.setHighwayChallengeActive(false);
        }
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
        if (player.getPendingDecisionPoint() != null) {
            return false;
        }
        if (player.isHighwayChallengeActive()) {
            return false;
        }
        if (now < player.getDecisionCooldownUntilMs()) {
            return false;
        }
        return ThreadLocalRandom.current().nextDouble() < DECISION_TRIGGER_PROBABILITY;
    }

    private void issueNewQuestion(PlayerState player, int difficulty, boolean highwayChallenge, long now) {
        var generated = questionGeneratorService.generateQuestion(difficulty);
        PendingQuestion pending = new PendingQuestion(generated, now + generated.timeLimitMs(), highwayChallenge);
        player.setPendingQuestion(pending);
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
    }

    private void resetRoomForNewRace(GameRoomState room, long now) {
        room.setRaceStopped(false);
        room.setRaceStartedAtMs(now);
        room.setRaceStoppedAtMs(0L);
        room.setWinnerPlayerId(null);
        room.setResultPersisted(false);
        room.setPersistRetryAtMs(0L);
        room.setTick(0L);
        room.setLastInteractionAtMs(now);
        room.getPlayers().values().forEach(this::resetPlayerForNewRace);
    }

    private void issueQuestionsForAllPlayers(GameRoomState room, long now, List<QuestionMessage> output) {
        for (PlayerState racer : room.getPlayers().values()) {
            if (racer.isFinished()) {
                continue;
            }
            if (racer.getPendingQuestion() == null || now > racer.getPendingQuestion().getExpiresAtMs()) {
                issueNewQuestion(racer, 1, false, now);
            }
            output.add(toQuestionMessage(room.getRoomId(), racer, racer.getPendingQuestion()));
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

    private static boolean isCorrectAnswer(String submittedAnswer, String expectedAnswer) {
        if (submittedAnswer == null || expectedAnswer == null) {
            return false;
        }
        return submittedAnswer.trim().equalsIgnoreCase(expectedAnswer.trim());
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
        RoomJoinedMessage joinedMessage,
        List<QuestionMessage> questionMessages,
        boolean raceRestarted,
        GameStateUpdateMessage immediateStateUpdate
    ) {
    }

    public record AnswerOutcome(
        String roomId,
        String playerId,
        boolean accepted,
        boolean correct,
        QuestionMessage nextQuestion,
        DecisionPointMessage decisionPoint
    ) {
        public static AnswerOutcome rejected(String roomId, String playerId, boolean correct) {
            return new AnswerOutcome(roomId, playerId, false, correct, null, null);
        }

        public AnswerOutcome withQuestion(QuestionMessage questionMessage) {
            return new AnswerOutcome(roomId, playerId, accepted, correct, questionMessage, decisionPoint);
        }
    }

    public record DecisionOutcome(
        String roomId,
        String playerId,
        boolean accepted,
        QuestionMessage nextQuestion
    ) {
        public static DecisionOutcome rejected(String roomId, String playerId) {
            return new DecisionOutcome(roomId, playerId, false, null);
        }

        public DecisionOutcome withQuestion(QuestionMessage questionMessage) {
            return new DecisionOutcome(roomId, playerId, accepted, questionMessage);
        }
    }

    public record TickDispatch(
        List<GameStateUpdateMessage> stateUpdates,
        List<QuestionMessage> questionUpdates
    ) {
    }

    private record FinishCandidate(
        PlayerState player,
        long crossedAtMs
    ) {
    }
}
