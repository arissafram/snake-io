# Classroom Snake

A simple multiplayer snake game (slither.io-style) for a class to play together in one
shared room. Everyone joins the same URL, steers with the mouse/touch, eats food to grow,
and dies on colliding with another snake — their body then becomes food for everyone else.
The world is a fixed size and wraps around at the edges (no walls, but bounded so nobody
can wander off into empty space).

## Run locally

```bash
npm install
npm start
```

Then open http://localhost:3000. Open it in a couple of browser tabs to see multiple
snakes at once.

## Deploy online (Render)

This repo includes a `render.yaml` blueprint for [Render](https://render.com):

1. Push this repo to GitHub.
2. In Render, click **New > Blueprint**, connect the repo, and deploy (free tier works).
3. Once deployed, share the Render URL with your class.

Any other Node host that supports WebSockets (Railway, Fly.io, etc.) works too — just
make sure it runs `npm install` then `npm start`, and that it respects the `PORT`
environment variable (the server already does).

## Tuning

Gameplay constants (world size, speed, turn rate, food density, spawn invulnerability,
etc.) are declared at the top of `server.js` if you want to adjust difficulty or arena
size for your class size.
