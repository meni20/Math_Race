# Asphalt Math Racing (Browser Multiplayer MVP)

## Stack
- Backend: Java 21, Spring Boot 3, STOMP WebSocket + SockJS, PostgreSQL, in-memory live state with `ConcurrentHashMap`.
- Frontend: React 18 + TypeScript, React Three Fiber, Zustand, TailwindCSS, STOMP client.

## Structure
- `server/` contains the Spring Boot backend and multiplayer game logic.
- `client/` contains the React/Vite frontend and 3D racing scene.

## Run Server
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
2. Optional env:
   - `VITE_BACKEND_URL=http://localhost:8080`
3. Start:
   - `npm run dev`

## Render Env
- Server reads `PORT` automatically on Render, with `SERVER_PORT` still supported locally.
- For PostgreSQL on Render, set `SPRING_PROFILES_ACTIVE=db` and either:
  - `DB_URL`
  - or `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`
- For the deployed frontend URL, set `ALLOWED_ORIGINS=https://<your-client>.onrender.com`
- For the client service, set `VITE_BACKEND_URL=https://<your-server>.onrender.com`
- Example env files live at `server/.env.example` and `client/.env.example`

## Key Files
- Server WebSocket config: `server/src/main/java/com/asphalt8/backend/config/WebSocketConfig.java`
- Server-authoritative loop: `server/src/main/java/com/asphalt8/backend/engine/GameEngine.java`
- Live game state + rules: `server/src/main/java/com/asphalt8/backend/service/GameStateService.java`
- Dynamic question generator: `server/src/main/java/com/asphalt8/backend/service/QuestionGeneratorService.java`
- R3F scene + camera/interpolation: `client/src/game/scene/RaceScene.tsx`
- Zustand state store: `client/src/game/store/useGameStore.ts`
- STOMP client bridge: `client/src/game/network/gameSocket.ts`

## Balancing Spec
- See `GAME_SPEC.md`
