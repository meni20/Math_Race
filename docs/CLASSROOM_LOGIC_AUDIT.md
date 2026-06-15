# Classroom Logic Audit

Audit date: 2026-05-29

Scope: report only. No gameplay, UI, transport, database, or deployment changes were applied.

## A. Executive summary

The current classroom race is partly score-based and partly still distance/track-based. The score migration updated server scoring and some HUD text, but several visual, list, and persistence paths still use `positionMeters`, fixed track geometry, and background polling.

Top root causes:

1. Classroom visual movement continues in `advanceClassroomRenderedPlayer()` because it advances rendered `positionMeters` every animation frame, including the finished branch, before setting `speedMps` to 0.
2. `useRenderedPlayers` keeps a `requestAnimationFrame` loop alive for every mounted subscriber, with no terminal classroom finish gate.
3. `submitAnswer()` finishes the canonical `game_rooms.state_json`, but returns `skipClassroomSync: true`, so `classroom_rooms` can remain `WAITING` or `RACING`, `is_listed = true`, and visible to students.
4. `FinishOverlay` still has a `Progress` column rendered from `formatMeters(player.positionMeters)`.
5. Track visuals are finite: road/dashes/pillars/trees/props/grandstands are generated to fixed z ranges, while classroom visual `positionMeters` can grow for high `targetScore` and even after finish.

Recommended order:

1. Stop movement/timers/sync after classroom finish and remove distance display from finish overlay.
2. Fix map/track score-based rendering safely.
3. Fix stale rooms source and remove hardcoded/localStorage/demo room leaks from the active list path.
4. Only then consider Phase B transport migration.

## B. Race complete / movement root cause

### Finding B1: rendered classroom movement continues after finish

File path: `client/src/game/utils/renderMotion.ts`

Function: `advanceClassroomRenderedPlayer()`

Exact condition causing issue:

- `classroomVisualMode` is enabled from `useRenderedPlayers()` when `sessionMode === "shared" && roomCreatorPlayerId === ""`.
- `advanceClassroomRenderedPlayer()` computes:
  - `previousPosition = max(previousPlayer.positionMeters, authoritativeScorePosition)`
  - `visualSpeedMps = kmhToMps(CLASSROOM_BASE_SPEED_KMH + modifierKmh)`
  - `advancedPosition = previousPosition + visualSpeedMps * deltaSeconds`
  - `finishedPosition = targetPlayer.finished ? max(advancedPosition, targetPlayer.positionMeters) : advancedPosition`
  - `positionMeters = max(previousPosition, finishedPosition)`
- Therefore, when `targetPlayer.finished === true`, rendered `positionMeters` still takes `advancedPosition`, so the visible car and camera can continue moving even though rendered `speedMps` is set to 0.

Observed effect:

- The Race Complete overlay appears, but background car/camera position can continue to move.
- Any UI reading `useRenderedPlayers()` can see increasing rendered `positionMeters`.

Suggested fix:

- In classroom visual mode, make terminal finish freeze at a stable score-derived visual position.
- Recommended local rule:
  - If `targetPlayer.finished || targetPlayer.racePhase === "finish" || raceStopped`, return `positionMeters: max(authoritativeScorePosition, targetPlayer.positionMeters)` or a separately captured freeze position, with `speedMps: 0`.
  - Do not use `advancedPosition` when finished.
- Add a regression test to `client/src/game/utils/renderMotion.test.ts` for "classroom finished player does not advance position between frames".

Risk level: Medium. The change is narrow, but it affects the visual interpolation layer used by classroom mode.

Test/verification steps:

1. Start a classroom race with a low target score.
2. Answer until target score is reached.
3. Wait 10 seconds on the finish overlay.
4. Verify the rendered local car z position, camera target, and displayed progress do not increase.
5. Run render motion tests.

### Finding B2: the rendered players animation loop has no terminal classroom stop

File path: `client/src/game/utils/useRenderedPlayers.ts`

Function/store: `renderedPlayersStore.tick()`, `renderedPlayersStore.subscribe()`

Exact condition causing issue:

- `subscribe()` starts `window.requestAnimationFrame(tick)`.
- `tick()` always calls `advanceFrame(Date.now())`, publishes subscribers, and schedules another frame while `listeners.size > 0`.
- RaceScene, HUD, and FinishOverlay can remain mounted after finish, so listeners remain present.
- There is no check for `raceStopped`, `racePhase === "finish"`, or terminal lifecycle before advancing classroom visuals.

Suggested fix:

- Keep the animation loop for rendering if needed, but make classroom motion advancement terminal-aware.
- Lowest-risk fix is in `renderMotion.ts`, not in the external store:
  - When classroom terminal state is reached, return frozen rendered players.
- Optional later optimization:
  - In `tick()`, publish less frequently or stop advancing mutable positions after terminal finish while still allowing static subscribers.

Risk level: Low to Medium. Freezing in `renderMotion.ts` is safer than stopping the whole `requestAnimationFrame` loop because RaceScene effects may still need rendering.

Test/verification steps:

1. Put logging or a unit test around `advanceRenderedPlayers()` output.
2. Confirm repeated calls with increasing `nowMs` do not change `positionMeters` after classroom finish.
3. Confirm non-classroom solo/personal rendering is unchanged.

### Finding B3: RaceScene directly maps rendered meters to world z

File path: `client/src/game/scene/RaceScene.tsx`

Functions/components: `PlayerCar`, `CameraRig`

Exact condition causing issue:

- `PlayerCar` computes `targetZ = -renderedPlayer.positionMeters * TRACK_Z_SCALE`.
- `CameraRig` computes `targetZ = -renderedLocalPlayer.positionMeters * TRACK_Z_SCALE`.
- If rendered classroom `positionMeters` continues increasing, the car and camera continue moving down the track.

Suggested fix:

- Do not change RaceScene first. Fix the upstream rendered classroom position freeze.
- In Phase 2, introduce a classroom visual progress value derived from score progress instead of raw meters.

Risk level: Medium if changed directly; Low if fixed upstream first.

Test/verification steps:

1. Inspect `targetZ` before and after finish using dev tooling.
2. Confirm it remains stable under the finish overlay.

### Finding B4: server finish state itself is mostly correct

File path: `supabase/functions/_shared/game-core.ts`

Functions: `setPlayerProgressMeters()`, `submitAnswer()`, `stopRace()`, `buildStateUpdate()`

Exact condition:

- In classroom rooms, `setPlayerProgressMeters()` treats score as progress and sets:
  - `player.score = clamped`
  - `player.positionMeters = clamped`
  - `player.finished = true` at `targetScore`
- `submitAnswer()` calls `stopRace(room, player, now)` when `player.finished && !room.raceStopped`.
- `stopRace()` sets:
  - `room.racePhase = "finish"`
  - `room.raceStopped = true`
  - `room.endedAtMs = now`
  - all active/starting players to `racePhase = "finish"` and `speedMps = 0`
- `buildStateUpdate()` reports finished players at `positionMeters = room.trackLengthMeters`.

Remaining problem:

- The server still exposes score through `positionMeters` for classroom compatibility.
- The client visual layer then treats that value as unbounded visual distance.

Suggested fix:

- Keep server terminal state behavior.
- Separate classroom score progress from visual distance on the client.
- Eventually remove classroom dependence on `positionMeters` after all consumers are migrated.

Risk level: Low for diagnosis; Medium for future contract cleanup.

Test/verification steps:

1. Inspect `submit-answer` response at finish.
2. Verify `stateUpdate.racePhase === "finish"`, `raceStopped === true`, `lifecycleStatus === "FINISHED"`, `question === null`.

## C. Classroom HUD / finish overlay leftover distance root cause

### Finding C1: FinishOverlay still displays meters

File path: `client/src/components/FinishOverlay.tsx`

Component/function: `FinishOverlay()`, `formatMeters()`

Exact condition causing issue:

- The results table header still says `Progress`.
- Each row renders `formatMeters(player.positionMeters)`.
- `formatMeters()` returns strings like `123 m`.
- The data comes from `useRenderedPlayers()`, so it can be affected by the visual movement bug.

Suggested fix:

- For classroom finish overlay, remove the distance/progress column entirely or replace it with score-based fields:
  - `Score`
  - `Correct`
  - `Wrong`
  - `Timeout`
  - `Status`
- If the overlay is shared by classroom and non-classroom modes, gate the distance column to non-classroom modes only.

Risk level: Low.

Test/verification steps:

1. Finish a classroom race.
2. Verify no `m`, `km`, `distance`, or meter-based `Progress` appears in the finish overlay.
3. Verify personal/solo results still show any intended distance fields if required.

### Finding C2: HUD still imports and computes distance-to-finish values

File path: `client/src/components/Hud.tsx`

Component/function: `Hud()`

Exact condition causing issue:

- `Hud()` imports `getDistanceToFinishMeters()` and `isPlayerOnFinalLap()`.
- It computes `distanceToFinishGateMeters`, `lapsRemainingToFinish`, and `finalLapActive`.
- Classroom sessions are gated from the non-classroom panel by `!isClassroomSession`, so the distance text should not appear for classroom students while active.
- However, the computations still run before the classroom UI branch and still rely on rendered distance.

Suggested fix:

- Keep classroom HUD score-only.
- Move distance/lap computations inside the non-classroom branch or memoize behind `!isClassroomSession`.
- Ensure no classroom text path can render `Finish: ${formatDistance(...)}`, `Opens in X laps`, meters, or km.

Risk level: Low.

Test/verification steps:

1. Run classroom mode and search the visible UI for `m`, `km`, `lap`, `Finish:`.
2. Run personal/solo mode and ensure intended distance UI still works.

## D. Active classroom list polling root cause

### Finding D1: Join Room panel schedules automatic list polling every 30 seconds

File path: `client/src/components/LobbyPanel.tsx`

Functions/constants: `ACTIVE_CLASSROOM_REFRESH_INTERVAL_MS`, `refreshActiveClassrooms()`, `scheduleActiveClassroomRefresh()`, active-list `useEffect`

Exact code path:

1. `shouldRefreshActiveClassrooms = joinBoxOpen && !isClassroomSession`.
2. When true, the effect calls `refreshActiveClassrooms(false)`.
3. In `.finally()`, it calls `scheduleActiveClassroomRefresh()`.
4. `scheduleActiveClassroomRefresh()` sets `window.setTimeout(..., ACTIVE_CLASSROOM_REFRESH_INTERVAL_MS)`.
5. The timeout calls `refreshActiveClassrooms(false)` and then recursively schedules the next timeout.
6. The constant is `30000`, so this is expected current behavior every 30 seconds.

Whether there is still an interval/timeout:

- There is no `setInterval` for the active room list.
- There is a recursive `setTimeout` scheduler.

Current stop conditions:

- Join panel closed.
- Student is already in a classroom room (`isClassroomSession`).
- Document hidden.
- Component cleanup.
- In-flight request guard prevents overlapping requests.

Is this expected from Phase A?

- Yes, based on the current code and diagnostics, automatic polling appears intentionally implemented for Phase A.
- `syncLifecycle` even diagnoses automatic request frequency but does not block it.

Should it be manual-refresh only?

- Product decision required, but based on the user's expected behavior, safe Phase 1 should switch this to manual-refresh only.
- If the panel is open and the user is idle, the least surprising network behavior is no automatic refresh, only initial load and refresh-icon clicks.

After finished race and return to lobby/menu:

- `FinishOverlay` calls `gameSocket.returnToLobby()` for shared sessions.
- If the student remains in the classroom session, `isClassroomSession` stays true and active list polling should remain off.
- If the user fully leaves/resets to menu and opens Join Room again, polling resumes under current code.

Suggested fix:

- Remove the recursive scheduler for student active room list.
- Keep:
  - one fetch when the panel opens, or
  - manual refresh only, depending on final product choice.
- If manual-only, call `refreshActiveClassrooms(true)` only from the refresh button and do not schedule another timeout afterward.
- Keep diagnostics to prove no automatic list calls happen while idle.

Risk level: Low.

Test/verification steps:

1. Open Join Room panel.
2. Observe network for 90 seconds.
3. Verify no repeated `list-active-classroom-rooms` calls unless clicking refresh.
4. Close panel and verify no active list timers.
5. Join a classroom and verify no active list calls while in-room.

### Finding D2: Supabase Realtime could later replace list polling

File path: `client/src/game/network/classroomRooms.ts`, `supabase/functions/list-active-classroom-rooms/index.ts`

Current state:

- `SupabaseClassroomRoomService.listActiveRooms()` invokes the Edge Function `list-active-classroom-rooms`.
- There is no Realtime subscription for the active room list.

Suggested future fix:

- After stale room correctness is fixed, add a Realtime subscription to `classroom_rooms` filtered to visible statuses and update the local active list reactively.
- Keep manual refresh as fallback.
- Do not do this before Phase 1-3 because transport changes could mask stale data problems.

Risk level: Medium if done now; Low if done after persistence correctness.

Test/verification steps:

1. Verify inserts/updates/deletes in `classroom_rooms` update the active list.
2. Simulate Realtime disconnect and confirm manual refresh fallback works.

## E. Map/track finite-environment root cause

### Finding E1: finish gate placement uses track length, not score progress near completion

File path: `client/src/game/scene/RaceScene.tsx`

Component: `FinishGate()`

Exact condition causing issue:

- `gateVisible = racePhase === "active" || racePhase === "finish"`.
- `gateZ = -trackLengthMeters * TRACK_Z_SCALE`.
- The finish gate is always placed at one raw track-length position.
- In classroom mode, `trackLengthMeters` is being mapped to target score, but rendered visual position can advance independently from score and can exceed the generated visual environment.

Why the finish arch appears early:

- For low or moderate target scores, `gateZ` may be close enough that the player quickly reaches/passes it.
- For high target scores, the gate is still a single fixed object and does not reflect normalized score progress visibility rules.
- Gate visibility is phase-based, not "near 100% score progress".

Suggested fix:

- In classroom mode, drive gate visibility/position from score progress:
  - `scoreProgress = clamp(localScore / targetScore, 0, 1)`.
  - Show/approach the gate only near a threshold such as 90%-100%.
  - Use a normalized virtual visual track length independent of target score.

Risk level: Medium.

Test/verification steps:

1. Run classroom races with target scores 50, 300, 1000, and 10000.
2. Verify the finish gate does not appear or get crossed near the start.
3. Verify it appears only near final score progress.

### Finding E2: the visual environment is finite

File path: `client/src/game/scene/RaceScene.tsx`

Components/functions:

- `NeonTrack()`
- `SunnyForestProps()`
- `FunWorldProps()`
- `StadiumGrandstands()`
- `Snowfall()`
- `SideProgressMarkers()`

Exact fixed lengths still used:

- `TRACK_Z_SCALE = 0.24`.
- Road plane is centered at z `-900` with length `2600`, so it spans roughly z `400` to `-2200`.
- Lane dash segments: `Array.from({ length: 340 }, index => -(index * 6))`, ending around z `-2034`.
- Side pillars: `Array.from({ length: 40 }, index => -20 - index * 28)`, ending around z `-1112`.
- Sunny forest trees: 56 trees, two per row, `z = 22 - row * 34 + offset`, ending around z `-896`.
- Fun World props: 18 props, two per row, `z = 16 - floor(index / 2) * 42`, ending around z `-320`.
- Grandstand sections: 13 sections, `18 - index * 18`, ending around z `-198`; floodlights only at `12, -42, -96, -150`.
- Snowfall particle z range is random from about `25` to `-145`.
- Side progress markers are only 10 fixed markers along `trackLengthMeters`.

Why assets disappear:

- Camera z follows `-renderedLocalPlayer.positionMeters * TRACK_Z_SCALE`.
- At target score 10000, a score-derived position can map to z about `-2400`.
- The road plane ends near `-2200`, while trees, poles, fun props, and grandstands end much earlier.
- As the camera moves past each finite prop band, those assets are behind the camera and disappear, leaving only sky/background/road or eventually sparse geometry.

Whether visual distance is unbounded:

- In classroom visual mode, yes from the client perspective. `advanceClassroomRenderedPlayer()` can keep increasing rendered `positionMeters` over time.
- Authoritative server snapshots are bounded to `targetScore`, but the client can render beyond them because visual advancement is time-based.

Suggested fix options:

A. Infinite/repeating environment

- Recycle road dashes, side props, trees, and poles relative to camera/player z using modulo math.
- Pros: supports any target score.
- Cons: more rendering logic, needs careful key/stability handling, more regression risk.

B. TargetScore-scaled virtual track

- Generate enough environment based on targetScore.
- Pros: conceptually simple.
- Cons: targetScore up to 10000 creates large object counts or sparse scaling; can hurt performance and still uses meters as visual distance.

C. Clamp/normalize visual position by score progress

- Map classroom score progress to a fixed visual track length, such as 900-1400 visual meters.
- Place finish gate at 100% of that virtual track.
- Freeze at 100%.
- Pros: least object churn, clear score semantics, smallest Phase 2 blast radius.
- Cons: large target scores move more slowly visually unless interpolation is tuned.

D. Hybrid approach

- Use normalized score progress for car/camera/finish placement.
- Also recycle decorative environment bands around the camera for richness.
- Pros: best long-term visual quality and supports any target score.
- Cons: more code than C.

Recommended safest approach:

- Phase 2 should use C first: clamp/normalize classroom visual position by score progress.
- Then optionally add lightweight recycling for decorations as a follow-up.
- Avoid generating a targetScore-length world for 10000-point races.

Risk level: Medium.

Test/verification steps:

1. Test target scores 50, 300, 1000, 10000.
2. Confirm no early finish arch crossing.
3. Confirm road and side environment remain populated for at least 2 minutes.
4. Confirm finish overlay freezes the visual position.
5. Verify personal/solo non-classroom maps still behave as before.

## F. Stale rooms root cause

### Finding F1: active room list source is Supabase `classroom_rooms` in Supabase mode

File path: `client/src/game/network/classroomRooms.ts`

Function: `SupabaseClassroomRoomService.listActiveRooms()`

Exact source:

- In Supabase mode, student active room list calls `list-active-classroom-rooms`.
- That Edge Function reads Supabase `classroom_rooms`.

File path: `supabase/functions/list-active-classroom-rooms/index.ts`

Function: Edge handler

Exact source:

- Calls `listActiveClassroomRooms(createAdminClient())`.

File path: `supabase/functions/_shared/classroom-store.ts`

Function: `listActiveClassroomRooms()`

Exact filters:

- `deleted_at is null`
- `closed_at is null`
- `ended_at is null`
- `is_listed = true`
- `is_locked = false`
- `status in ("WAITING", "RACING")`
- `currentPlayers < maxPlayers`
- final filter: `room.status === "WAITING" || room.allowMidGameJoin`

Whether RUNNING/RACING rooms are supposed to be listed:

- Yes, current code intentionally lists `RACING` rooms when `allowMidGameJoin` is true.
- Lobby UI labels those as `Running` and allows joining if other joinability conditions pass.

Suggested fix:

- Decide whether RACING mid-game join is still desired.
- If classroom races should only be joined before start, remove `RACING` from the active list filter and UI joinability.
- If mid-game join remains desired, keep it, but ensure finished rooms are always unlisted and ended.

Risk level: Low to Medium depending on mid-game join product decision.

Test/verification steps:

1. Create a waiting room; verify it appears.
2. Start a race with `allowMidGameJoin = true`; verify expected listing behavior.
3. Finish the race; verify it disappears.
4. Delete the room; verify it disappears.

### Finding F2: score-finished rooms may not update `classroom_rooms`

File path: `supabase/functions/_shared/game-core.ts`

Function: `submitAnswer()`

Exact condition causing issue:

- On target score, `submitAnswer()` calls `stopRace()` and returns `persist: true`.
- The returned mutation also sets `skipClassroomSync: true`.

File path: `supabase/functions/_shared/room-store.ts`

Function: `runRoomMutation()`

Exact condition causing issue:

- `runRoomMutation()` only calls `upsertClassroomRoomFromState()` when `!result.skipClassroomSync`.
- Therefore the canonical `game_rooms.state_json` can be finished while `classroom_rooms` remains stale, listed, unlocked, and possibly `WAITING` or `RACING`.

Why teacher deletion may not remove stale rooms:

- If the teacher deletes the current visible room, `teacher-delete-room` marks that specific `classroom_rooms` row deleted by `room_code` and `teacher_id`.
- But score-finished rows can remain active until deleted.
- Rooms created by old teacher sessions, other browsers, or pre-migration rows may not be targeted by the current teacher's delete actions because deletion is scoped to `teacher_id = teacherSessionId`.
- If the stale row is from the score-finish skip path, it will remain in the student list until explicitly deleted/archived or corrected.

Suggested fix:

- Do not skip classroom sync on terminal finish.
- Safe minimal change:
  - In `submitAnswer()`, set `skipClassroomSync` only for non-terminal answer updates.
  - If `room.raceStopped || room.racePhase === "finish" || player.finished`, allow `upsertClassroomRoomFromState()` to run.
- Ensure terminal upsert writes `status = FINISHED`, `ended_at`, `is_listed = false`, `is_locked = true`.
- Add a test or integration check that score finish removes the room from `list-active-classroom-rooms`.

Risk level: Medium. It touches server mutation persistence, but only terminal classroom summary sync should change.

Test/verification steps:

1. Create classroom room.
2. Start race.
3. Finish by score via `submit-answer`.
4. Query `classroom_rooms` and verify `status = FINISHED`, `ended_at not null`, `is_listed = false`, `is_locked = true`.
5. Call `list-active-classroom-rooms`; verify the room is absent.
6. Verify teacher dashboard still receives finish state.

### Finding F3: localStorage rooms exist only in local-dev adapter

File path: `client/src/game/network/localClassroom.ts`

Functions/constants: `LOCAL_CLASSROOM_ROOM_PREFIX`, `listLocalClassroomRooms()`

Exact condition:

- Local-dev classroom rooms are stored under localStorage keys with prefix `math-race.classroom.`.
- `LocalDevClassroomRoomService.listActiveRooms()` lists localStorage rooms, filters by current `devSessionId`, then `isJoinable`.
- In Supabase mode, this path is not used.

Whether rooms are coming from localStorage:

- In Supabase mode: no.
- In local-dev mode: yes, by design.

Suggested fix:

- Add a diagnostics display or dev-only log showing active classroom adapter mode.
- If Supabase is configured, prevent local-dev room summaries from being mixed into active list.
- Provide a dev utility to clear `math-race.classroom.*` keys when needed.

Risk level: Low.

Test/verification steps:

1. Check `getClassroomAdapterInfo().mode`.
2. In Supabase mode, clear browser localStorage and verify active list is unchanged.
3. In local-dev mode, verify deleting localStorage rooms removes them from active list.

### Finding F4: no hardcoded/demo rooms are injected into Active classrooms

File path: `client/src/components/LobbyPanel.tsx`, `client/src/App.tsx`

Exact condition:

- `arena-1` is used as a default room input/fallback, not as an active room list item.
- No hardcoded `arena-1` active classroom summary is injected into `activeLobbies`.
- On list refresh error, `LobbyPanel` clears `activeLobbies` instead of preserving stale state.

Suggested fix:

- Keep active list sourced only from the selected classroom adapter.
- Avoid using `arena-1` as a classroom default when Supabase classroom mode is active, if it causes user confusion.

Risk level: Low.

Test/verification steps:

1. Search UI after failed active-list fetch; verify no fake room appears.
2. Verify `arena-1` does not appear unless it exists in the backend/local-dev source.

## G. Communication lifecycle after finish

### Finish sequence currently observed in code

1. Student submits answer.
   - File: `client/src/game/network/supabaseGame.ts`
   - Function: `submitAnswer()`
   - It invokes `submit-answer` and applies the response.

2. Server scores answer and reaches target.
   - File: `supabase/functions/_shared/game-core.ts`
   - Functions: `applyProgressDelta()`, `setPlayerProgressMeters()`, `submitAnswer()`
   - Classroom score is written to `player.score` and `player.positionMeters`.
   - At target, `player.finished = true`.

3. Server marks room finished.
   - File: `supabase/functions/_shared/game-core.ts`
   - Function: `stopRace()`
   - Sets `racePhase = "finish"`, `raceStopped = true`, `endedAtMs = now`, clears questions/decisions, speed 0.

4. Response sent to student.
   - File: `supabase/functions/_shared/game-core.ts`
   - Function: `submitAnswer()`
   - Response includes `stateUpdate`, `question: null`, `decision: null`, `answerFeedback`.

5. Student receives finish state.
   - File: `client/src/game/store/useGameStore.ts`
   - Function: `applyStateUpdate()`
   - Normalizes local `racePhase` to `finish`, clears question/decision/prediction, sets `raceFinishedAtMs`.

6. Student sync-room fallback.
   - File: `client/src/game/network/supabaseGame.ts`
   - Function: `sync()`
   - `sync()` stops the sync loop if a `sync-room` response has lifecycle `FINISHED`.
   - Realtime update handler also stops sync if lifecycle is terminal.
   - However, `applyResponse()` for `submit-answer` does not stop sync immediately when action response has terminal lifecycle.
   - Therefore one or more already scheduled fallback `sync-room` calls can still occur after finish until Realtime or the next sync returns `FINISHED`.

7. Student Realtime subscription.
   - File: `client/src/game/network/supabaseGame.ts`
   - Function: `subscribeToRoomChanges()`
   - On terminal lifecycle from Realtime, it stops the sync loop.
   - It does not unsubscribe the Realtime channel on finish unless `disconnect()` is called; it only stops sync.

8. Teacher SSE.
   - File: `supabase/functions/teacher-room-events/index.ts`
   - Function: `sendSnapshot()` loop
   - Polls server-side with `setInterval(SNAPSHOT_POLL_MS)`.
   - Sends terminal `room_finished` when lifecycle is `FINISHED`, then closes stream.
   - File: `client/src/components/teacher/teacherGameClient.ts`
   - `onUpdate()` stops live SSE when event is `room_finished`, `room_closed`, or `room_deleted`.

9. Teacher polling fallback.
   - File: `client/src/components/teacher/teacherGameClient.ts`
   - Functions: `startSupabaseSync()`, `scheduleTeacherSync()`, `runTeacherSync()`
   - Guards block `teacher-sync-room` while SSE is healthy and stop polling on terminal lifecycle.

10. Student returns to lobby.
    - File: `client/src/components/FinishOverlay.tsx`
    - `handleReturn()` calls `gameSocket.returnToLobby()` for shared sessions.
    - File: `supabase/functions/_shared/game-core.ts`
    - `returnPlayerToLobby()` resets the player and, if nobody is actively racing, calls `resetRoomForNewRace()`.
    - `resetRoomForNewRace()` clears `raceStopped` and `endedAtMs` but does not explicitly unlist/lock the room.
    - Since `stopRace()` also does not set `isListed = false`, a returned-to-lobby finished room can become visible again if the classroom summary is synced.

11. Teacher deletes room.
    - File: `supabase/functions/teacher-delete-room/index.ts`
    - Calls `teacherDeleteRoom()` against `game_rooms`, then `markClassroomRoomDeleted()` against `classroom_rooms`.
    - Deletion is scoped by `room_code` and current `teacherSessionId`.

### Which timers/subscriptions remain alive after finish

Should stop:

- Student `sync-room` fallback timeout after terminal `FINISHED`.
- Teacher polling fallback after terminal lifecycle.
- Teacher SSE stream after `room_finished`.
- Classroom visual movement advancement.

Currently can remain:

- Student Realtime channel remains subscribed after terminal finish until disconnect/leave. It stops sync but does not remove channel.
- `useRenderedPlayers` animation frame loop remains while components subscribe.
- Join Room active-list timeout resumes when the Join Room panel is open and the student is not in a classroom session.

Should remain:

- Static rendering and finish overlay.
- Optional Realtime subscription only if needed for deletion/removal notices after finish. Otherwise it can be unsubscribed on terminal finish to reduce background activity.

Suggested fix:

- In `SupabaseGameClient.applyResponse()`, after any `stateUpdate`, stop the student sync loop immediately if `shouldStopForLifecycle(response.stateUpdate.lifecycleStatus)`.
- Decide whether to unsubscribe Realtime on terminal finish. Safest Phase 1: stop fallback sync immediately; leave Realtime until explicit return/leave if needed for delete notices.
- Prevent `returnPlayerToLobby()` from reactivating a finished classroom room unless the teacher intentionally starts a new race.

Risk level: Medium.

Test/verification steps:

1. Finish classroom race.
2. Verify no `sync-room` requests after the finish response except at most one intentional final sync.
3. Verify Realtime status is understood: either unsubscribed or intentionally connected.
4. Click Return to Lobby and verify active room list behavior matches product decision.
5. Teacher deletes room and student receives terminal/removed state without polling leakage.

## H. Recommended fix plan by phases

### Phase 1: stop movement/timers/sync after classroom finish and remove distance display

Tasks:

1. Freeze classroom rendered movement after terminal finish.
   - Files: `client/src/game/utils/renderMotion.ts`, `client/src/game/utils/renderMotion.test.ts`
   - Suggested fix: make `advanceClassroomRenderedPlayer()` return a stable terminal `positionMeters` and `speedMps = 0`.
   - Risk: Medium.
   - Verification: finish race, wait 10 seconds, no background movement.

2. Stop student fallback sync immediately on terminal action response.
   - File: `client/src/game/network/supabaseGame.ts`
   - Suggested fix: after `applyResponse()` sees `stateUpdate.lifecycleStatus === "FINISHED" | "CLOSED" | "DELETED"`, call `stopSyncLoop()`.
   - Risk: Low to Medium.
   - Verification: Network tab has no repeated `sync-room` after finish.

3. Remove classroom meters from finish overlay.
   - File: `client/src/components/FinishOverlay.tsx`
   - Suggested fix: replace `Progress`/`formatMeters(player.positionMeters)` with score-only fields, at least for classroom sessions.
   - Risk: Low.
   - Verification: no meter/distance labels on classroom finish overlay.

4. Guard HUD distance computations/rendering for classroom.
   - File: `client/src/components/Hud.tsx`
   - Suggested fix: keep classroom HUD score-only; move distance computations into non-classroom branch.
   - Risk: Low.
   - Verification: no classroom `m`, `km`, lap, or finish-distance text.

5. Ensure score finish updates `classroom_rooms`.
   - Files: `supabase/functions/_shared/game-core.ts`, `supabase/functions/_shared/room-store.ts`
   - Suggested fix: do not use `skipClassroomSync` for terminal finish.
   - Risk: Medium.
   - Verification: score-finished room disappears from `list-active-classroom-rooms`.

### Phase 2: fix map/track score-based rendering safely

Tasks:

1. Introduce classroom visual progress mapping.
   - File: `client/src/game/utils/renderMotion.ts` or a new small visual helper.
   - Suggested fix: map `score / targetScore` to a fixed virtual visual distance.
   - Risk: Medium.
   - Verification: targetScore 50-10000 remains visually coherent.

2. Move finish gate to normalized score progress.
   - File: `client/src/game/scene/RaceScene.tsx`
   - Suggested fix: gate appears near 90%-100% classroom score progress, not at raw `trackLengthMeters`.
   - Risk: Medium.
   - Verification: no early arch crossing.

3. Optional environment recycling.
   - File: `client/src/game/scene/RaceScene.tsx`
   - Suggested fix: recycle side props/dashes relative to camera after normalized mapping is stable.
   - Risk: Medium to High.
   - Verification: long runs do not empty the scene.

### Phase 3: fix stale rooms source and remove hardcoded/localStorage/demo leak

Tasks:

1. Fix terminal classroom summary persistence.
   - Files: `supabase/functions/_shared/game-core.ts`, `supabase/functions/_shared/room-store.ts`, `supabase/functions/_shared/classroom-store.ts`
   - Suggested fix: terminal state always writes `classroom_rooms` as `FINISHED`, unlisted, locked, ended.
   - Risk: Medium.
   - Verification: finished rooms absent from active list.

2. Decide RACING joinability.
   - File: `supabase/functions/_shared/classroom-store.ts`, `client/src/components/LobbyPanel.tsx`
   - Suggested fix: keep or remove RACING mid-game joins explicitly.
   - Risk: Low to Medium.
   - Verification: active list matches chosen policy.

3. Make active list manual-refresh only if desired.
   - File: `client/src/components/LobbyPanel.tsx`
   - Suggested fix: remove recursive 30-second timeout; keep refresh button.
   - Risk: Low.
   - Verification: no idle active-list network calls.

4. Add adapter diagnostics for active list.
   - File: `client/src/game/network/classroomRooms.ts` or existing diagnostics UI.
   - Suggested fix: expose whether active list is Supabase, local-dev, or unavailable.
   - Risk: Low.
   - Verification: stale room source is visible during debugging.

### Phase 4: only after that, consider Phase B transport migration

Tasks:

1. Consider replacing active list polling with Supabase Realtime on `classroom_rooms`.
2. Consider unsubscribing student Realtime after terminal finish if no post-finish delete/remove notices are needed.
3. Keep manual refresh as fallback.

Risk level: Medium to High if done before Phases 1-3; Low to Medium after correctness is fixed.

Test/verification steps:

1. Confirm no transport migration changes behavior.
2. Confirm network quietness after finish.
3. Confirm room list correctness under create/start/finish/delete.
