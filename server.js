const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const TICK_RATE = 30; // simulation & broadcast ticks per second
const TICK_MS = 1000 / TICK_RATE;

const WORLD_WIDTH = 2000; // bounded, wrap-around world (no infinite space to get lost in)
const WORLD_HEIGHT = 1400; // sized for a ~15-20 player classroom; still feels fine with just 1-2

const BASE_SPEED = 125; // units/sec
const TURN_RATE = 4.2; // radians/sec, how fast a snake can steer

const SEGMENT_SPACING = 10; // world units between body segments
const START_SEGMENTS = 8;
const GROWTH_PER_FOOD = 2; // segments gained per normal food
const SCORE_PER_FOOD = 2;
const DEATH_FOOD_SCORE = 5;

const HEAD_RADIUS = 10;
const SNAKE_RADIUS = 9;
const FOOD_RADIUS = 5;
const DEATH_FOOD_RADIUS = FOOD_RADIUS + 10; // noticeably bigger/wider than ambient food

const FOOD_TARGET_COUNT = 130; // scaled down to match the smaller world's area
const FOOD_SPAWN_PER_TICK = 3; // max ambient food spawned per tick while below target

const SPAWN_INVULN_MS = 2000; // brief safety window after (re)spawning
const MIN_SPAWN_DIST_FROM_OTHERS = 150;

const MAX_NAME_LENGTH = 16;
const MAX_EMOJI_LENGTH = 8; // generous enough for multi-codepoint emoji (skin tones, ZWJ sequences)
const LEADERBOARD_SIZE = 10;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
/** @type {Map<string, Player>} */
const players = new Map();
/** @type {Array<{id:number,x:number,y:number,r:number,value:number,color:string}>} */
let food = [];
let nextFoodId = 1;

function wrapDelta(d, size) {
  d = d % size;
  if (d > size / 2) d -= size;
  if (d < -size / 2) d += size;
  return d;
}

function wrapCoord(v, size) {
  return ((v % size) + size) % size;
}

function toroidalDist(x1, y1, x2, y2) {
  const dx = wrapDelta(x1 - x2, WORLD_WIDTH);
  const dy = wrapDelta(y1 - y2, WORLD_HEIGHT);
  return Math.hypot(dx, dy);
}

const FOOD_COLORS = ['#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#f78c6b'];

function randomFoodColor() {
  return FOOD_COLORS[(Math.random() * FOOD_COLORS.length) | 0];
}

function spawnFoodItem(overrides = {}) {
  const item = {
    id: nextFoodId++,
    x: Math.random() * WORLD_WIDTH,
    y: Math.random() * WORLD_HEIGHT,
    r: FOOD_RADIUS,
    value: SCORE_PER_FOOD,
    growth: GROWTH_PER_FOOD,
    color: randomFoodColor(),
    ...overrides,
  };
  food.push(item);
  return item;
}

function findSafeSpawn() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = Math.random() * WORLD_WIDTH;
    const y = Math.random() * WORLD_HEIGHT;
    let safe = true;
    for (const p of players.values()) {
      if (!p.alive) continue;
      if (toroidalDist(x, y, p.x, p.y) < MIN_SPAWN_DIST_FROM_OTHERS) {
        safe = false;
        break;
      }
    }
    if (safe) return { x, y };
  }
  return { x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT };
}

function sanitizeName(rawName) {
  const name = String(rawName || '').trim().slice(0, MAX_NAME_LENGTH);
  return name.length > 0 ? name : 'Player';
}

function sanitizeColor(rawColor) {
  return typeof rawColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : '#4cc9f0';
}

function sanitizeEmoji(rawEmoji) {
  return String(rawEmoji || '').trim().slice(0, MAX_EMOJI_LENGTH);
}

class Player {
  constructor(id, name, color, emoji) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.emoji = emoji;
    this.score = 0;
    this.alive = true;
    this.respawn(true);
  }

  respawn() {
    const { x, y } = findSafeSpawn();
    this.x = x;
    this.y = y;
    this.angle = Math.random() * Math.PI * 2;
    this.targetAngle = this.angle;
    this.length = START_SEGMENTS;
    this.trail = [{ x, y }];
    this.segments = new Array(START_SEGMENTS).fill({ x, y });
    this.alive = true;
    this.invulnerableUntil = Date.now() + SPAWN_INVULN_MS;
  }

  applyInput(angle) {
    if (typeof angle === 'number' && !Number.isNaN(angle)) {
      this.targetAngle = angle;
    }
  }

  tick(dt) {
    // Turn toward target angle at a limited rate (shortest angular direction).
    let diff = this.targetAngle - this.angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const maxTurn = TURN_RATE * dt;
    if (diff > maxTurn) diff = maxTurn;
    if (diff < -maxTurn) diff = -maxTurn;
    this.angle += diff;

    const dist = BASE_SPEED * dt;
    this.x += Math.cos(this.angle) * dist;
    this.y += Math.sin(this.angle) * dist;

    // Extend trail (kept in unbounded space so segment interpolation never
    // jumps across the map when the head wraps around an edge).
    this.trail.push({ x: this.x, y: this.y });
    const neededTrailLen = Math.ceil((this.length * SEGMENT_SPACING) / dist) + 2;
    if (this.trail.length > neededTrailLen) {
      this.trail.splice(0, this.trail.length - neededTrailLen);
    }

    // Resample the trail at even spacing to produce body segments.
    const segs = [];
    let distAccum = 0;
    let idx = this.trail.length - 1;
    let prev = this.trail[idx];
    segs.push({ x: prev.x, y: prev.y });
    while (segs.length < this.length && idx > 0) {
      const cur = this.trail[idx - 1];
      const segDist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      distAccum += segDist;
      while (distAccum >= SEGMENT_SPACING && segs.length < this.length) {
        const overshoot = distAccum - SEGMENT_SPACING;
        const t = segDist > 0 ? overshoot / segDist : 0;
        const px = cur.x + (prev.x - cur.x) * t;
        const py = cur.y + (prev.y - cur.y) * t;
        segs.push({ x: px, y: py });
        distAccum -= SEGMENT_SPACING;
      }
      prev = cur;
      idx--;
    }
    while (segs.length < this.length) {
      segs.push({ x: prev.x, y: prev.y });
    }
    this.segments = segs;
  }

  isInvulnerable() {
    return Date.now() < this.invulnerableUntil;
  }

  wrappedHead() {
    return { x: wrapCoord(this.x, WORLD_WIDTH), y: wrapCoord(this.y, WORLD_HEIGHT) };
  }
}

// ---------------------------------------------------------------------------
// Socket handling
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.on('join', ({ name, color, emoji }) => {
    const safeName = sanitizeName(name);
    const safeColor = sanitizeColor(color);
    const safeEmoji = sanitizeEmoji(emoji);
    const player = new Player(socket.id, safeName, safeColor, safeEmoji);
    players.set(socket.id, player);
    socket.emit('joined', { id: socket.id, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT });
  });

  socket.on('input', (data) => {
    const player = players.get(socket.id);
    if (player && player.alive) {
      player.applyInput(data && data.angle);
    }
  });

  socket.on('customize', (data) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (data && data.color !== undefined) player.color = sanitizeColor(data.color);
    if (data && data.emoji !== undefined) player.emoji = sanitizeEmoji(data.emoji);
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
  });
});

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
function killPlayer(player) {
  player.alive = false;
  // Turn the body into food; skip every other segment to avoid overwhelming density.
  for (let i = 0; i < player.segments.length; i += 2) {
    const seg = player.segments[i];
    spawnFoodItem({
      x: wrapCoord(seg.x, WORLD_WIDTH),
      y: wrapCoord(seg.y, WORLD_HEIGHT),
      r: DEATH_FOOD_RADIUS,
      value: DEATH_FOOD_SCORE,
      growth: GROWTH_PER_FOOD + 1,
      color: player.color,
    });
  }
  io.to(player.id).emit('died', { score: player.score });
  players.delete(player.id);
}

function maintainAmbientFood() {
  let toSpawn = Math.min(FOOD_SPAWN_PER_TICK, FOOD_TARGET_COUNT - food.length);
  while (toSpawn > 0) {
    spawnFoodItem();
    toSpawn--;
  }
}

function tick() {
  const dt = 1 / TICK_RATE;

  for (const player of players.values()) {
    if (player.alive) player.tick(dt);
  }

  // Food consumption
  for (const player of players.values()) {
    if (!player.alive) continue;
    const head = player.wrappedHead();
    for (let i = food.length - 1; i >= 0; i--) {
      const f = food[i];
      if (toroidalDist(head.x, head.y, f.x, f.y) < HEAD_RADIUS + f.r) {
        player.score += f.value;
        player.length += f.growth;
        food.splice(i, 1);
      }
    }
  }
  maintainAmbientFood();

  // Player-vs-player collisions (head touches any other snake's body)
  const casualties = [];
  for (const a of players.values()) {
    if (!a.alive || a.isInvulnerable()) continue;
    const head = a.wrappedHead();
    outer: for (const b of players.values()) {
      if (a.id === b.id || !b.alive) continue;
      for (const seg of b.segments) {
        const sx = wrapCoord(seg.x, WORLD_WIDTH);
        const sy = wrapCoord(seg.y, WORLD_HEIGHT);
        if (toroidalDist(head.x, head.y, sx, sy) < HEAD_RADIUS + SNAKE_RADIUS) {
          casualties.push(a);
          break outer;
        }
      }
    }
  }
  for (const c of casualties) {
    if (players.has(c.id)) killPlayer(c);
  }

  broadcastState();
}

function computeLeaderboard() {
  return Array.from(players.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, LEADERBOARD_SIZE)
    .map((p) => ({ name: p.name, score: p.score }));
}

function broadcastState() {
  const state = {
    players: Array.from(players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      emoji: p.emoji,
      score: p.score,
      invulnerable: p.isInvulnerable(),
      segments: p.segments.map((s) => [
        Math.round(wrapCoord(s.x, WORLD_WIDTH) * 10) / 10,
        Math.round(wrapCoord(s.y, WORLD_HEIGHT) * 10) / 10,
      ]),
    })),
    food: food.map((f) => [Math.round(f.x * 10) / 10, Math.round(f.y * 10) / 10, f.r, f.color]),
    leaderboard: computeLeaderboard(),
  };
  io.emit('state', state);
}

setInterval(tick, TICK_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Classroom snake server listening on port ${PORT}`);
});
