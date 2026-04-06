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
    public void restartRaceIssuesQuestionsForAllPlayers() {
        gameStateService.joinRoom(new JoinRoomRequest("arena-1", "p-1", "Player One"));
        gameStateService.joinRoom(new JoinRoomRequest("arena-1", "p-2", "Player Two"));

        GameRoomState room = gameStateService.getRooms().iterator().next();
        synchronized (room.getLock()) {
            room.setRaceStopped(true);
            room.setWinnerPlayerId("p-1");
        }

        GameStateService.JoinOutcome outcome = gameStateService.joinRoom(
            new JoinRoomRequest("arena-1", "p-1", "Player One")
        );

        assertTrue(outcome.raceRestarted());
        assertEquals(2, outcome.questionMessages().size());
    }

    @Test
    public void wrongDecisionEventIsRejectedWithoutDroppingDecision() {
        gameStateService.joinRoom(new JoinRoomRequest("arena-2", "p-1", "Player One"));
        GameRoomState room = gameStateService.getRooms().iterator().next();

        PlayerState player;
        synchronized (room.getLock()) {
            player = room.getPlayers().get("p-1");
            assertNotNull(player);
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
        assertNull(outcome.nextQuestion());
        synchronized (room.getLock()) {
            assertNotNull(player.getPendingDecisionPoint());
        }
    }

    @Test
    public void joinRoomReturnsInitialSnapshotWithRenderablePlayerState() {
        GameStateService.JoinOutcome outcome = gameStateService.joinRoom(
            new JoinRoomRequest("arena-3", "p-1", "Player One")
        );

        assertNotNull(outcome.immediateStateUpdate());
        assertEquals(1, outcome.immediateStateUpdate().players().size());
        assertEquals(1, outcome.questionMessages().size());

        var snapshot = outcome.immediateStateUpdate().players().get(0);
        assertEquals("p-1", snapshot.playerId());
        assertEquals("Player One", snapshot.displayName());
        assertEquals(0, snapshot.laneIndex());
        assertEquals(0.0, snapshot.positionMeters());
        assertEquals(42.0, snapshot.speedMps());
        assertEquals(0, snapshot.lap());
        assertFalse(snapshot.finished());
        assertTrue(Double.isFinite(snapshot.positionMeters()));
        assertTrue(Double.isFinite(snapshot.speedMps()));
    }

    @Test
    public void tickSanitizesInvalidTelemetryBeforeBroadcast() {
        gameStateService.joinRoom(new JoinRoomRequest("arena-4", "p-1", "Player One"));
        GameRoomState room = gameStateService.getRooms().iterator().next();

        synchronized (room.getLock()) {
            PlayerState player = room.getPlayers().get("p-1");
            assertNotNull(player);
            player.setPositionMeters(Double.NaN);
            player.setSpeedMps(Double.NaN);
            player.setLap(-5);
        }

        GameStateService.TickDispatch dispatch = gameStateService.tickAndBuildUpdates(0.05);
        assertEquals(1, dispatch.stateUpdates().size());

        var snapshot = dispatch.stateUpdates().get(0).players().get(0);
        assertTrue(Double.isFinite(snapshot.positionMeters()));
        assertTrue(Double.isFinite(snapshot.speedMps()));
        assertEquals(0, snapshot.lap());
        assertTrue(snapshot.positionMeters() >= 0.0);
        assertTrue(snapshot.speedMps() >= 0.0);
    }

    @Test
    public void tickClampsInvalidLaneIndexBeforeBroadcast() {
        gameStateService.joinRoom(new JoinRoomRequest("arena-5", "p-1", "Player One"));
        GameRoomState room = gameStateService.getRooms().iterator().next();

        synchronized (room.getLock()) {
            PlayerState player = room.getPlayers().get("p-1");
            assertNotNull(player);
            player.setLaneIndex(999);
        }

        GameStateService.TickDispatch dispatch = gameStateService.tickAndBuildUpdates(0.05);
        assertEquals(1, dispatch.stateUpdates().size());

        var snapshot = dispatch.stateUpdates().get(0).players().get(0);
        assertEquals(3, snapshot.laneIndex());
    }
}
