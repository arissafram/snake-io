// ----------------------------------------
// BOARD SETUP
// ----------------------------------------

let GRID_SIZE = 20;
let CELL = 24;
let TICK_MS = 120;

// How the snake grows: length adds a whole new segment per food
// (handled naturally by not popping the tail below). Width grows
// much more slowly — a small fraction of a pixel per food — so the
// snake visibly thickens over a long game without ever catching up
// to how fast it lengthens.
let BASE_SEGMENT_SIZE = 18;
let MAX_SEGMENT_SIZE = 27;
let WIDTH_GROWTH_PER_FOOD = 0.4;

// Poison apples: a chance to appear after eating regular food. Eating
// one doesn't grow the snake, it just triggers a temporary 2x speed
// boost (and a banner so it's obvious why things suddenly got hectic).
let POISON_SPAWN_CHANCE = 0.4;
let POISON_BOOST_MULTIPLIER = 2;
let POISON_BOOST_MS = 6000;

let canvas = document.getElementById("board");
let ctx = canvas.getContext("2d");
let scoreEl = document.getElementById("score");
let overlay = document.getElementById("overlay");
let overlayMessage = document.getElementById("overlayMessage");
let restartButton = document.getElementById("restartButton");
let banner = document.getElementById("banner");

let customizeToggle = document.getElementById("customizeToggle");
let customizePanel = document.getElementById("customizePanel");
let bodyColorInput = document.getElementById("bodyColorInput");
let headEmojiInput = document.getElementById("headEmojiInput");


// ----------------------------------------
// CUSTOMIZATION (remembered between visits)
// ----------------------------------------

let bodyColor = localStorage.getItem("snakeBodyColor") || "#81a2be";
let headEmoji = localStorage.getItem("snakeHeadEmoji");
if (headEmoji === null) headEmoji = "🐍";

bodyColorInput.value = bodyColor;
headEmojiInput.value = headEmoji;

customizeToggle.addEventListener("click", function () {
  customizePanel.classList.toggle("is-hidden");
});

bodyColorInput.addEventListener("input", function () {
  bodyColor = bodyColorInput.value;
  localStorage.setItem("snakeBodyColor", bodyColor);
  render();
});

headEmojiInput.addEventListener("input", function () {
  headEmoji = headEmojiInput.value;
  localStorage.setItem("snakeHeadEmoji", headEmoji);
  render();
});


// ----------------------------------------
// GAME STATE
// ----------------------------------------

let snake, direction, pendingDirection, food, poisonApple, foodEaten, running;
let gameInterval = null;
let poisonRevertTimer = null;

function resetState() {
  snake = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 }
  ];
  direction = { x: 1, y: 0 };
  pendingDirection = { x: 1, y: 0 };
  foodEaten = 0;
  running = true;
  poisonApple = null;
  food = randomEmptyCell([]);
  scoreEl.textContent = "Score: 0";
  overlay.classList.add("is-hidden");

  if (poisonRevertTimer !== null) {
    clearTimeout(poisonRevertTimer);
    poisonRevertTimer = null;
  }
  hideBanner();
  setSpeed(TICK_MS);
}


// ----------------------------------------
// HELPERS
// ----------------------------------------

function isOccupied(cell, avoid) {
  if (snake.some(function (seg) { return seg.x === cell.x && seg.y === cell.y; })) return true;
  return avoid.some(function (c) { return c && c.x === cell.x && c.y === cell.y; });
}

function randomEmptyCell(avoid) {
  let cell;
  do {
    cell = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE)
    };
  } while (isOccupied(cell, avoid));
  return cell;
}

function currentSegmentSize() {
  return Math.min(MAX_SEGMENT_SIZE, BASE_SEGMENT_SIZE + foodEaten * WIDTH_GROWTH_PER_FOOD);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCell(cell, size, color) {
  let px = cell.x * CELL + CELL / 2;
  let py = cell.y * CELL + CELL / 2;
  ctx.fillStyle = color;
  roundRect(px - size / 2, py - size / 2, size, size, 4);
  ctx.fill();
}

function drawEmoji(cell, size, emoji) {
  let px = cell.x * CELL + CELL / 2;
  let py = cell.y * CELL + CELL / 2;
  ctx.font = Math.round(size * 1.3) + "px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, px, py);
}

function showBanner(message) {
  banner.textContent = message;
  banner.classList.remove("is-hidden");
}

function hideBanner() {
  banner.classList.add("is-hidden");
}

function setSpeed(ms) {
  if (gameInterval !== null) clearInterval(gameInterval);
  gameInterval = setInterval(tick, ms);
}


// ----------------------------------------
// RENDER
// ----------------------------------------

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawCell(food, 16, "#f0c674");
  if (poisonApple) drawEmoji(poisonApple, 22, "☠️");

  let segSize = currentSegmentSize();
  snake.forEach(function (segment, i) {
    if (i === 0 && headEmoji.trim()) {
      drawEmoji(segment, segSize, headEmoji);
    } else {
      drawCell(segment, segSize, i === 0 ? "#8abeb7" : bodyColor);
    }
  });
}


// ----------------------------------------
// GAME LOOP
// ----------------------------------------

function tick() {
  if (!running) return;

  direction = pendingDirection;
  let head = snake[0];
  let newHead = { x: head.x + direction.x, y: head.y + direction.y };

  let hitWall = newHead.x < 0 || newHead.x >= GRID_SIZE || newHead.y < 0 || newHead.y >= GRID_SIZE;

  if (hitWall) {
    // bounce off the wall instead of dying: the tail becomes the new
    // head and the snake continues back the way it came. (Just
    // reversing direction without flipping the array would send the
    // head straight into its own neck, since the body already trails
    // along that exact path.)
    snake.reverse();
    direction = { x: -direction.x, y: -direction.y };
    pendingDirection = direction;
    return;
  }

  let hitSelf = snake.some(function (seg) { return seg.x === newHead.x && seg.y === newHead.y; });

  if (hitSelf) {
    endGame();
    return;
  }

  snake.unshift(newHead);

  if (poisonApple && newHead.x === poisonApple.x && newHead.y === poisonApple.y) {
    poisonApple = null;
    snake.pop();
    triggerPoisonBoost();
  } else if (newHead.x === food.x && newHead.y === food.y) {
    foodEaten++;
    scoreEl.textContent = "Score: " + foodEaten;
    food = randomEmptyCell(poisonApple ? [poisonApple] : []);
    if (!poisonApple && Math.random() < POISON_SPAWN_CHANCE) {
      poisonApple = randomEmptyCell([food]);
    }
  } else {
    snake.pop();
  }

  render();
}

function triggerPoisonBoost() {
  showBanner("☠️ Poison apple! Speed x" + POISON_BOOST_MULTIPLIER);
  setSpeed(TICK_MS / POISON_BOOST_MULTIPLIER);

  if (poisonRevertTimer !== null) clearTimeout(poisonRevertTimer);
  poisonRevertTimer = setTimeout(function () {
    setSpeed(TICK_MS);
    hideBanner();
    poisonRevertTimer = null;
  }, POISON_BOOST_MS);
}

function endGame() {
  running = false;
  overlayMessage.textContent = "Game Over — Score: " + foodEaten;
  overlay.classList.remove("is-hidden");
}


// ----------------------------------------
// CONTROLS
// ----------------------------------------

let KEY_DIRECTIONS = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  W: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  S: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  A: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
  D: { x: 1, y: 0 }
};

window.addEventListener("keydown", function (event) {
  // let typing into the customize inputs work normally
  if (event.target && event.target.tagName === "INPUT") return;

  if (event.key === " ") {
    event.preventDefault();
    if (!running) resetState();
    return;
  }

  let dir = KEY_DIRECTIONS[event.key];
  if (!dir) return;

  event.preventDefault();

  // don't allow reversing straight back into yourself
  if (dir.x === -direction.x && dir.y === -direction.y) return;

  pendingDirection = dir;
});

restartButton.addEventListener("click", resetState);


// ----------------------------------------
// START
// ----------------------------------------

resetState();
render();
