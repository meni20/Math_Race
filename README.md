# Asphalt Math Racing (Browser Multiplayer MVP)

## Stack
- Production shared-room runtime: Supabase Edge Functions + Supabase client transport.
- Optional local realtime runtime: Java 21, Spring Boot 3, STOMP WebSocket + SockJS, PostgreSQL, in-memory live state with `ConcurrentHashMap`.
- Frontend: React 18 + TypeScript, React Three Fiber, Zustand, TailwindCSS, STOMP client, Supabase client.

## Structure
- `server/` contains the Spring Boot backend and multiplayer game logic.
- `client/` contains the React/Vite frontend and 3D racing scene.

## Run Server
Use this only when you want the optional WebSocket runtime locally. Production currently defaults to the Supabase transport.

1. Default local mode starts without PostgreSQL and keeps profiles/race history in memory.
2. Start:
   - `cd server`
   - `.\gradlew.bat bootRun`
3. Optional PostgreSQL mode:
   - Set `SPRING_PROFILES_ACTIVE=db`
   - Set `DB_URL` or `DB_HOST` + `DB_PORT` + `DB_NAME`
   - Set `DB_USER`
   - Set `DB_PASS`

## Run Client
1. Install dependencies:
   - `cd client`
   - `npm install`
2. Transport selection is config-driven:
   - Supabase is used only when both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set. This is the current production-default path.
   - WebSocket is used only when `VITE_BACKEND_URL` is explicitly set. This is an optional local realtime runtime.
   - Otherwise the client uses demo mode by default.
3. Optional env:
   - `VITE_BACKEND_URL=http://localhost:8080`
   - `VITE_SUPABASE_URL=https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=<your-anon-key>`
4. Start:
   - `npm run dev`

## Render Env
- Server reads `PORT` automatically on Render, with `SERVER_PORT` still supported locally.
- For PostgreSQL on Render, set `SPRING_PROFILES_ACTIVE=db` and either:
  - `DB_URL`
  - or `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`
- For the deployed frontend URL, set `ALLOWED_ORIGINS=https://<your-client>.onrender.com`
- For the client service, set `VITE_BACKEND_URL=https://<your-server>.onrender.com`
- Example env files live at `server/.env.example` and `client/.env.example`

## Local WebSocket Mode
Use this when you want to exercise the Spring/STOMP runtime instead of Supabase.

1. Start the websocket server:
   - `cd server`
   - `.\gradlew.bat bootRun`
2. Configure the frontend:
   - In `client/.env.local`, set `VITE_BACKEND_URL=http://localhost:8080`
   - Do not set `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` in that same local profile if you want websocket selected.
3. Start the client:
   - `cd client`
   - `npm run dev`
4. Expected selection rule:
   - Supabase wins when both Supabase env vars are present.
   - WebSocket is selected only when `VITE_BACKEND_URL` is set and Supabase vars are absent.
   - Demo is the fallback when neither backend is configured.

## WebSocket Checklist
Run this checklist when validating the optional websocket runtime locally.

1. Open the app in two browser windows with `VITE_BACKEND_URL` enabled.
2. Join the same shared room in both windows.
3. Confirm both players appear in the shared lobby roster.
4. Confirm the room creator sees the Teacher Race Setup editor and the other player sees summary-only fields.
5. Change race settings as the creator and confirm both windows receive the updated room summary.
6. Start the race and confirm both windows see the lobby countdown, then move into `active`.
7. Submit answers in both windows and confirm positions update live for both players.
8. Refresh one browser during lobby and during an active race; confirm it reconnects into the same room/player seat instead of becoming a duplicate.
9. Use `Exit to Lobby` for one player while the other keeps racing; confirm the room resolves back to a restartable lobby once no players are actively racing.
10. Use `Leave Room` from one browser and confirm the remaining browser roster updates correctly.

## Key Files
- Server WebSocket config: `server/src/main/java/com/asphalt8/backend/config/WebSocketConfig.java`
- Server-authoritative websocket loop: `server/src/main/java/com/asphalt8/backend/engine/GameEngine.java`
- WebSocket command/session bridge: `server/src/main/java/com/asphalt8/backend/service/GameCommandService.java`
- Live websocket room state + rules: `server/src/main/java/com/asphalt8/backend/service/GameStateService.java`
- Dynamic question generator: `server/src/main/java/com/asphalt8/backend/service/QuestionGeneratorService.java`
- Supabase shared-room authority: `supabase/functions/_shared/game-core.ts`
- R3F scene + camera/interpolation: `client/src/game/scene/RaceScene.tsx`
- Zustand state store: `client/src/game/store/useGameStore.ts`
- Transport bridge + selection: `client/src/game/network/gameSocket.ts`, `client/src/game/network/transportConfig.ts`

## Balancing Spec
- See `GAME_SPEC.md`
