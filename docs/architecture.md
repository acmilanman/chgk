Architecture overview (high level)
- Purpose: Web server for live quiz (ЛЕИ) with 3 client roles: admin, captain, player. Real-time state via WebSocket.
- Core ideas:
  - Modularization: separation of concerns (game engine, transport, persistence, admin logic).
  - Plain file-based persistence with an abstract storage layer to ease future migrations to async DBs.
- Modules to introduce (next patches):
  1) lib/storage.js: generic async read/write for files and ensuring directories.
  2) engine/game.js: business logic for questions, scores, timer, results.
  3) transport/ws.js: WebSocket routing between admin, captain, and player.
  4) api/admin.js / api/captain.js / api/player.js: role-specific command handlers.
- System overview
- The server orchestrates three client roles: admin, captain, player.
- State is maintained in memory and persisted to disk; a storage layer abstracts IO.
- Real-time updates are pushed via WebSocket channels per role.

- Major components
- lib/storage.js: asynchronous IO helpers (readText, writeText, ensureDir).
- engine/game.js: encapsulates game rules (timers, questions, scoring).
- transport/ws.js: WebSocket routing between admin, captain, and player.
- api/admin.js, api/captain.js, api/player.js: role-specific command handlers.

- Data flow
- Admin/captain/player actions send WS messages; server updates in-memory state and persists via storage.
- Server broadcasts state changes to connected clients by role.
- On startup, server loads the latest game state from disk, if present.

- Security and access
- Roles enforced at WS layer; admin endpoints optionally protected by tokens if enabled.
- Logs include admin actions with audit data; plaintext passwords can be controlled via env (toggle in future expansions).

- Deployment and environment
- Run in Node.js environment; data stored under data/ in repo.
- Use environment variables for configuration (PORT, ADMIN_TOKEN, etc.).

- Testing and QA
- Add unit tests for game logic and IO path; integration tests for WS flows.
- Smoke tests should verify transitions between phases (waiting -> question -> answer, etc.).

- Roadmap
- Patch 4: complete modularization (engine/ws/api modules) and replace sync IO with async storage.
- Patch 5: hardened security, more robust logging/audit.
- Patch 6+: tests and docs.
