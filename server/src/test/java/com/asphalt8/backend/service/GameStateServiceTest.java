package com.asphalt8.backend.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.asphalt8.backend.entity.UserProfile;
import com.asphalt8.backend.game.dto.DecisionChoiceRequest;
import com.asphalt8.backend.game.dto.JoinRoomRequest;
import com.asphalt8.backend.game.dto.RoomPlayerRequest;
import com.asphalt8.backend.game.dto.RoomSettings;
import com.asphalt8.backend.game.dto.UpdateRoomSettingsRequest;
import com.asphalt8.backend.game.model.DecisionPoint;
import com.asphalt8.backend.game.model.GameRoomState;
import com.asphalt8.backend.game.model.GeneratedQuestion;
import com.asphalt8.backend.game.model.PlayerState;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

public class GameStateServiceTest {

    private QuestionGeneratorService questionGeneratorService;
    private RaceHistoryService raceHistoryService;
    private UserProfileStore userProfileStore;
    private GameStateService gameStateService;

    @BeforeEach
    public void setUp() {
        questionGeneratorService = Mockito.mock(QuestionGeneratorService.class);
        raceHistoryService = Mockito.mock(RaceHistoryService.class);
        userProfileStore = Mockito.mock(UserProfileStore.class);

        when(userProfileStore.findById(anyString())).thenReturn(Optional.empty());
        when(userProfileStore.save(any(UserProfile.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(questionGeneratorService.generateQuestion(anyInt())).thenAnswer(invocation -> {
            int difficulty = invocation.getArgument(0);
            return new GeneratedQuestion(
                "q-" + difficulty + "-" + System.nanoTime(),
                "1 + 1",
                "2",
                difficulty,
                5000,
                1.0
            );
        });

        gameStateService = new GameStateService(
            questionGeneratorService,
            raceHistoryService,
            userProfileStore,
            1000.0,
            1
        );
    }

    @Test
    public void joinRoomReturnsLobbyStateWithTeacherSetupMetadata() {
        GameStateService.JoinOutcome outcome = gameStateService.joinRoom(
            new JoinRoomRequest("arena-3", "p-1", "Player One")
        );

        assertTrue(outcome.accepted());
        assertNotNull(outcome.joinedMessage());
        assertNotNull(outcome.stateUpdate());
        assertEquals("lobby", outcome.stateUpdate().racePhase());
        assertEquals("p-1", outcome.joinedMessage().roomCreatorPlayerId());
        assertEquals("p-1", outcome.stateUpdate().roomCreatorPlayerId());
        assertEquals("lobby", outcome.stateUpdate().players().get(0).racePhase());
        assertNull(outcome.question());
        assertNull(outcome.decision());
    }

    @Test
    public void startRaceTransitionsThroughStartingIntoActive() {
        gameStateService.joinRoom(new JoinRoomRequest("arena-1", "p-1", "Player One"));
        gameStateService.joinRoom(new JoinRoomRequest("arena-1", "p-2", "Player Two"));

        GameStateService.CommandOutcome startOutcome = gameStateService.startRace(
            new RoomPlayerRequest("arena-1", "p-1")
        );

        assertTrue(startOutcome.accepted());
        assertEquals("starting", startOutcome.stateUpdate().racePhase());

        GameRoomState room = gameStateService.getRooms().iterator().next();
        synchronized (room.getLock()) {
            room.setRaceStartingAtMs(System.currentTimeMillis() - 1L);
        }

        GameStateService.TickDispatch dispatch = gameStateService.tickAndBuildUpdates(0.05);
        assertEquals(1, dispatch.stateUpdates().size());
        assertEquals("active", dispatch.stateUpdates().get(0).racePhase());
        assertTrue(dispatch.stateUpdates().get(0).players().stream().allMatch(player -> "active".equals(player.racePhase())));
    }

    @Test
    public void wrongDecisionEventIsRejectedWithoutDroppingDecision() {
        gameStateService.joinRoom(new JoinRoomRequest("arena-2", "p-1", "Player One"));
        GameRoomState room = gameStateService.getRooms().iterator().next();

        PlayerState player;
        synchronized (room.getLock()) {
            room.setRacePhase("active");
            room.setRaceStartedAtMs(System.currentTimeMillis() - 1000L);
            room.setRaceStopped(false);
            room.setRaceStoppedAtMs(0L);
            player = room.getPlayers().get("p-1");
            assertNotNull(player);
            player.setRacePhase("active");
            player.setPendingQuestion(null);
            player.setPendingDecisionPoint(
                new DecisionPoint(
                    "evt-1",
                    "Pick one",
                    List.of("HIGHWAY", "DIRT"),
                    System.currentTimeMillis() + 5000
                )
            );
        }

        GameStateService.DecisionOutcome outcome = gameStateService.chooseDecision(
            new DecisionChoiceRequest("arena-2", "p-1", "evt-other", "DIRT")
        );

        assertFalse(outcome.accepted());
        synchronized (room.getLock()) {
            assertNotNull(player.getPendingDecisionPoint());
        }
    }

    @Test
    public void nonCreatorCannotUpdateTeacherSetup() {
        gameStateService.joinRoom(new JoinRoomRequest("arena-setup", "p-1", "Teacher"));
        gameStateService.joinRoom(new JoinRoomRequest("arena-setup", "p-2", "Student"));

        GameStateService.CommandOutcome outcome = gameStateService.updateRoomSettings(
            new UpdateRoomSettingsRequest(
                "arena-setup",
                "p-2",
                new RoomSettings("New Name", 4, 120, 10)
            )
        );

        assertFalse(outcome.accepted());
        assertEquals("ROOM_CREATOR_ONLY", outcome.errorCode());
    }

    @Test
    public void returnToLobbyResetsRoomWhenNoActiveRacersRemain() {
        gameStateService.joinRoom(new JoinRoomRequest("arena-return", "p-1", "Player One"));
        GameRoomState room = gameStateService.getRooms().iterator().next();

        synchronized (room.getLock()) {
            room.setRacePhase("active");
            room.setRaceStartedAtMs(System.currentTimeMillis() - 1000L);
            PlayerState player = room.getPlayers().get("p-1");
            assertNotNull(player);
            player.setRacePhase("active");
        }

        GameStateService.CommandOutcome outcome = gameStateService.returnPlayerToLobby(
            new RoomPlayerRequest("arena-return", "p-1")
        );

        assertTrue(outcome.accepted());
        assertNotNull(outcome.stateUpdate());
        assertEquals("lobby", outcome.stateUpdate().racePhase());
        assertEquals("lobby", outcome.stateUpdate().players().get(0).racePhase());
    }

    @Test
    public void multiplayerHumanFinishDoesNotStopRaceForActiveHumans() {
        gameStateService.joinRoom(new JoinRoomRequest("arena-multi-finish", "p-1", "Player One"));
        gameStateService.joinRoom(new JoinRoomRequest("arena-multi-finish", "p-2", "Player Two"));
        GameRoomState room = gameStateService.getRooms().iterator().next();
        long now = System.currentTimeMillis();

        synchronized (room.getLock()) {
            room.setRacePhase("active");
            room.setRaceStartedAtMs(now - 1000L);
            room.setLastInteractionAtMs(now - 1000L);
            PlayerState finisher = room.getPlayers().get("p-1");
            PlayerState racer = room.getPlayers().get("p-2");
            assertNotNull(finisher);
            assertNotNull(racer);
            finisher.setRacePhase("active");
            finisher.setPositionMeters(995D);
            finisher.setSpeedMps(100D);
            finisher.setBaseSpeedMps(100D);
            racer.setRacePhase("active");
            racer.setPositionMeters(100D);
            racer.setSpeedMps(20D);
            racer.setBaseSpeedMps(20D);
        }

        GameStateService.TickDispatch dispatch = gameStateService.tickAndBuildUpdates(0.05);

        assertEquals(1, dispatch.stateUpdates().size());
        assertEquals("active", dispatch.stateUpdates().get(0).racePhase());
        assertFalse(dispatch.stateUpdates().get(0).raceStopped());
        assertEquals("finish", dispatch.stateUpdates().get(0).players().stream()
            .filter(player -> "p-1".equals(player.playerId()))
            .findFirst()
            .orElseThrow()
            .racePhase());
        assertEquals("active", dispatch.stateUpdates().get(0).players().stream()
            .filter(player -> "p-2".equals(player.playerId()))
            .findFirst()
            .orElseThrow()
            .racePhase());
    }

    @Test
    public void timerExpiryStopsEveryoneAndRanksByCurrentPosition() {
        gameStateService.joinRoom(new JoinRoomRequest("arena-time-up", "p-1", "Player One"));
        gameStateService.joinRoom(new JoinRoomRequest("arena-time-up", "p-1-ai-1", "AI Driver"));
        GameRoomState room = gameStateService.getRooms().iterator().next();
        long now = System.currentTimeMillis();

        synchronized (room.getLock()) {
            room.setRoomSettings(new RoomSettings("Short Race", 4, 1, 5));
            room.setRacePhase("active");
            room.setRaceStartedAtMs(now - 2000L);
            room.setLastInteractionAtMs(now - 1500L);
            PlayerState human = room.getPlayers().get("p-1");
            PlayerState bot = room.getPlayers().get("p-1-ai-1");
            assertNotNull(human);
            assertNotNull(bot);
            human.setRacePhase("active");
            human.setPositionMeters(200D);
            human.setSpeedMps(0D);
            bot.setRacePhase("active");
            bot.setPositionMeters(700D);
            bot.setSpeedMps(0D);
        }

        GameStateService.TickDispatch dispatch = gameStateService.tickAndBuildUpdates(0.05);

        assertEquals(1, dispatch.stateUpdates().size());
        assertEquals("finish", dispatch.stateUpdates().get(0).racePhase());
        assertTrue(dispatch.stateUpdates().get(0).raceStopped());
        assertEquals("p-1-ai-1", dispatch.stateUpdates().get(0).winnerPlayerId());
        assertTrue(dispatch.stateUpdates().get(0).players().stream().allMatch(player -> "finish".equals(player.racePhase())));
        assertEquals("p-1-ai-1", dispatch.stateUpdates().get(0).players().get(0).playerId());
    }

    @Test
    public void singleHumanFinishStopsRaceAndResetsBotsBeforeNextLobby() {
        gameStateService.joinRoom(new JoinRoomRequest("arena-bot-cleanup", "p-1", "Player One"));
        gameStateService.joinRoom(new JoinRoomRequest("arena-bot-cleanup", "p-1-ai-1", "AI Driver"));
        GameRoomState room = gameStateService.getRooms().iterator().next();
        long now = System.currentTimeMillis();

        synchronized (room.getLock()) {
            room.setRacePhase("active");
            room.setRaceStartedAtMs(now - 1000L);
            room.setLastInteractionAtMs(now - 1000L);
            PlayerState human = room.getPlayers().get("p-1");
            PlayerState bot = room.getPlayers().get("p-1-ai-1");
            assertNotNull(human);
            assertNotNull(bot);
            human.setRacePhase("active");
            human.setPositionMeters(995D);
            human.setSpeedMps(100D);
            human.setBaseSpeedMps(100D);
            bot.setRacePhase("active");
            bot.setPositionMeters(100D);
            bot.setSpeedMps(20D);
            bot.setBaseSpeedMps(20D);
        }

        GameStateService.TickDispatch dispatch = gameStateService.tickAndBuildUpdates(0.05);

        assertEquals("finish", dispatch.stateUpdates().get(0).racePhase());
        assertTrue(dispatch.stateUpdates().get(0).raceStopped());
        assertEquals(2, dispatch.stateUpdates().get(0).players().size());

        GameStateService.CommandOutcome returnOutcome = gameStateService.returnPlayerToLobby(
            new RoomPlayerRequest("arena-bot-cleanup", "p-1")
        );

        assertTrue(returnOutcome.accepted());
        assertEquals("lobby", returnOutcome.stateUpdate().racePhase());
        assertEquals(2, returnOutcome.stateUpdate().players().size());
        assertTrue(returnOutcome.stateUpdate().players().stream().allMatch(player -> "lobby".equals(player.racePhase())));
        assertTrue(returnOutcome.stateUpdate().players().stream().allMatch(player -> !player.finished()));
        assertTrue(returnOutcome.stateUpdate().players().stream().allMatch(player -> player.positionMeters() == 0D));
    }
}
