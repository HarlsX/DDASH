# Doodle Dash

A multiplayer drawing-and-guessing party game for 2–8 players.

## Play locally

1. Open a terminal in this folder.
2. Run `npm start`.
3. Open `http://localhost:3000` in your browser.
4. Other players on the same Wi-Fi can join using your computer's local network address followed by `:3000`.

No install step or database is needed. Rooms live in memory and reset when the server stops.

## Put it online

The project is ready for any Node.js hosting service:

- Build command: none
- Start command: `npm start`
- Health check: `/health`
- Required environment variables: none

You can also deploy it as a Docker container using the included `Dockerfile`.

## Included

- Four-letter private room codes
- Live shared drawing canvas with colors and brush sizes
- Timed rounds and rotating artists
- Guess chat with answer protection
- Speed bonuses and artist points
- Scoreboard and replay flow
- Responsive desktop/mobile layout
