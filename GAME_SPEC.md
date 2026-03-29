# Multiplayer Math Racing - Initial Spec (MVP v0.1)

## 1. Core Runtime
- Server authority: Spring Boot scheduled `GameEngine` tick every `50ms`.
- Transport: WebSocket STOMP over SockJS.
- Multiplayer scope: Multi-room support via `ConcurrentHashMap<String, GameRoomState>`.
- State broadcast: `/topic/rooms/{roomId}/state`.
- Client rendering: React Three Fiber with interpolation between server snapshots.

## 2. Race Configuration
- Track length: `3000m`.
- Laps to finish: `3`.
- Base speed: `38 m/s` (~`137 km/h`).
- Minimum speed floor: `18 m/s`.

## 3. Acceleration and Boost Balancing
- Normal acceleration: `11 m/s²`.
- Boost acceleration: `28 m/s²`.
- Drag/deceleration: `8 m/s²`.
- Correct-answer boost duration: `3000ms`.
- Boost target speed formula: `baseSpeed + (34 * boostMultiplier)`.
- Wrong-answer penalty: `-7.5 m/s` (clamped by speed floor).

## 4. Question System
- Dynamic generation only (no static DB question bank).
- Question templates per difficulty:
  - Easy: `a+b`, `a-b`
  - Medium: `a*b`, `(a*b)+c`
  - Hard: `(a*b)-c`, `(a+b)*c`
- Time limits:
  - Easy: `9000ms`
  - Medium: `8000ms`
  - Hard: `7000ms`
- Difficulty progression:
  - Up with correct streak.
  - Down after wrong answer.
  - Late laps bias toward harder questions.

## 5. Decision Points (Highway vs Dirt)
- Trigger probability after correct answer: `22%`.
- Cooldown between decision points: `12000ms`.
- Decision timeout: `8000ms`.
- Highway:
  - Next question forced to hard.
  - If solved: `+240m` teleport + super boost extension (`+2200ms`) + multiplier amplification.
  - If failed: regular wrong-answer penalty and challenge cleared.
- Dirt:
  - Safe short boost (`~1600ms`, low multiplier).
  - Easier follow-up question than highway.

## 6. Persistence
- PostgreSQL stores:
  - `user_profiles`
  - `race_history`
- On first room finisher: race result snapshot stored with standings JSON payload.

## 7. STOMP Endpoints
- Client -> Server:
  - `/app/game.join`
  - `/app/game.answer`
  - `/app/game.decision`
- Server -> Client (per room):
  - `/topic/rooms/{roomId}/joined`
  - `/topic/rooms/{roomId}/state`
  - `/topic/rooms/{roomId}/question`
  - `/topic/rooms/{roomId}/decision`
  - `/topic/rooms/{roomId}/answer-feedback`
