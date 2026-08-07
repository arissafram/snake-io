(() => {
  const socket = io();

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const joinScreen = document.getElementById('join-screen');
  const deathScreen = document.getElementById('death-screen');
  const nameInput = document.getElementById('name-input');
  const playButton = document.getElementById('play-button');
  const respawnButton = document.getElementById('respawn-button');
  const finalScoreEl = document.getElementById('final-score');
  const leaderboardEl = document.getElementById('leaderboard');
  const leaderboardListEl = document.getElementById('leaderboard-list');
  const hudEl = document.getElementById('hud');
  const scoreDisplayEl = document.getElementById('score-display');
  const deathHeadingEl = document.getElementById('death-heading');
  const countdownScreen = document.getElementById('countdown-screen');
  const countdownNumberEl = document.getElementById('countdown-number');

  const customizeToggle = document.getElementById('customizeToggle');
  const customizePanel = document.getElementById('customizePanel');
  const bodyColorInput = document.getElementById('bodyColorInput');
  const headEmojiInput = document.getElementById('headEmojiInput');
  const joinColorInput = document.getElementById('joinColorInput');
  const joinEmojiInput = document.getElementById('joinEmojiInput');
  const zoomControls = document.getElementById('zoom-controls');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomResetBtn = document.getElementById('zoomResetBtn');

  const DEATH_MESSAGES = ["noooo you died", "oof couldn't keep up", "rip, better luck next time"];

  // ---------------------------------------------------------------------
  // Customization (remembered between visits, editable on join + mid-game)
  // ---------------------------------------------------------------------
  let bodyColor = localStorage.getItem('snakeBodyColor') || '#4cc9f0';
  let headEmoji = localStorage.getItem('snakeHeadEmoji');
  if (headEmoji === null) headEmoji = '🐍';

  bodyColorInput.value = bodyColor;
  headEmojiInput.value = headEmoji;
  joinColorInput.value = bodyColor;
  joinEmojiInput.value = headEmoji;

  function applyCustomization() {
    localStorage.setItem('snakeBodyColor', bodyColor);
    localStorage.setItem('snakeHeadEmoji', headEmoji);
    bodyColorInput.value = bodyColor;
    headEmojiInput.value = headEmoji;
    joinColorInput.value = bodyColor;
    joinEmojiInput.value = headEmoji;
    if (alive) socket.emit('customize', { color: bodyColor, emoji: headEmoji });
  }

  customizeToggle.addEventListener('click', () => {
    customizePanel.classList.toggle('is-hidden');
  });
  bodyColorInput.addEventListener('input', () => {
    bodyColor = bodyColorInput.value;
    applyCustomization();
  });
  headEmojiInput.addEventListener('input', () => {
    headEmoji = headEmojiInput.value;
    applyCustomization();
  });
  joinColorInput.addEventListener('input', () => {
    bodyColor = joinColorInput.value;
    applyCustomization();
  });
  joinEmojiInput.addEventListener('input', () => {
    headEmoji = joinEmojiInput.value;
    applyCustomization();
  });

  let myId = null;
  let worldWidth = 2000;
  let worldHeight = 1400;
  let latestState = { players: [], food: [], leaderboard: [] };
  let alive = false;

  // ---------------------------------------------------------------------
  // Zoom: manual scroll/pinch/keys/buttons, clamped so zooming all the way
  // out brings the whole arena (and everyone in it) into view.
  // ---------------------------------------------------------------------
  const DEFAULT_ZOOM = 1;
  const MAX_ZOOM = 1.6;
  let zoom = DEFAULT_ZOOM;
  let minZoom = 0.3;

  function updateZoomBounds() {
    const fitX = canvas.width / worldWidth;
    const fitY = canvas.height / worldHeight;
    minZoom = Math.max(0.15, Math.min(fitX, fitY) * 0.95);
    zoom = Math.min(MAX_ZOOM, Math.max(minZoom, zoom));
  }

  function setZoom(z) {
    zoom = Math.min(MAX_ZOOM, Math.max(minZoom, z));
  }

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    updateZoomBounds();
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY * 0.001));
  }, { passive: false });

  zoomOutBtn.addEventListener('click', () => setZoom(zoom - 0.15));
  zoomInBtn.addEventListener('click', () => setZoom(zoom + 0.15));
  zoomResetBtn.addEventListener('click', () => setZoom(DEFAULT_ZOOM));

  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.key === '-' || e.key === '_') setZoom(zoom - 0.08);
    if (e.key === '=' || e.key === '+') setZoom(zoom + 0.08);
  });

  function touchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }
  let pinchStartDist = null;
  let pinchStartZoom = DEFAULT_ZOOM;

  function storedName() {
    return localStorage.getItem('snake_name') || '';
  }
  nameInput.value = storedName();

  function doJoin() {
    const name = nameInput.value.trim().slice(0, 16) || 'Player';
    localStorage.setItem('snake_name', name);
    socket.emit('join', { name, color: bodyColor, emoji: headEmoji });
  }

  function runCountdown(onComplete) {
    let n = 3;
    countdownNumberEl.textContent = n;
    countdownScreen.classList.remove('hidden');
    const interval = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(interval);
        countdownScreen.classList.add('hidden');
        onComplete();
      } else {
        countdownNumberEl.textContent = n;
      }
    }, 800);
  }

  function beginJoinFlow() {
    joinScreen.classList.add('hidden');
    runCountdown(doJoin);
  }

  playButton.addEventListener('click', beginJoinFlow);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') beginJoinFlow();
  });
  respawnButton.addEventListener('click', () => {
    deathScreen.classList.add('hidden');
    runCountdown(doJoin);
  });

  socket.on('joined', (data) => {
    myId = data.id;
    worldWidth = data.worldWidth;
    worldHeight = data.worldHeight;
    alive = true;
    joinScreen.classList.add('hidden');
    deathScreen.classList.add('hidden');
    leaderboardEl.classList.remove('hidden');
    hudEl.classList.remove('hidden');
    zoomControls.classList.remove('hidden');
    updateZoomBounds();
  });

  socket.on('died', (data) => {
    alive = false;
    myId = null;
    deathHeadingEl.textContent = DEATH_MESSAGES[Math.floor(Math.random() * DEATH_MESSAGES.length)];
    finalScoreEl.textContent = `Final score: ${data.score}`;
    leaderboardEl.classList.add('hidden');
    hudEl.classList.add('hidden');
    zoomControls.classList.add('hidden');
    customizePanel.classList.add('is-hidden');
    deathScreen.classList.remove('hidden');
  });

  socket.on('state', (state) => {
    latestState = state;
    updateLeaderboard(state.leaderboard);
    const me = state.players.find((p) => p.id === myId);
    if (me) {
      scoreDisplayEl.textContent = `Score: ${me.score}`;
    }
  });

  function updateLeaderboard(list) {
    leaderboardListEl.innerHTML = '';
    for (const entry of list) {
      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = entry.name;
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'lb-score';
      scoreSpan.textContent = entry.score;
      li.appendChild(nameSpan);
      li.appendChild(scoreSpan);
      leaderboardListEl.appendChild(li);
    }
  }

  // ---------------------------------------------------------------------
  // Input: steer toward the mouse/touch position relative to screen center
  // ---------------------------------------------------------------------
  let pointerAngle = 0;
  function setPointerFromClient(clientX, clientY) {
    const dx = clientX - canvas.width / 2;
    const dy = clientY - canvas.height / 2;
    if (Math.hypot(dx, dy) > 4) {
      pointerAngle = Math.atan2(dy, dx);
    }
  }
  canvas.addEventListener('mousemove', (e) => setPointerFromClient(e.clientX, e.clientY));
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinchStartDist = touchDist(e.touches);
      pinchStartZoom = zoom;
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinchStartDist) {
      e.preventDefault();
      setZoom(pinchStartZoom * (touchDist(e.touches) / pinchStartDist));
      return;
    }
    if (e.touches.length === 1) {
      setPointerFromClient(e.touches[0].clientX, e.touches[0].clientY);
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) pinchStartDist = null;
  });

  setInterval(() => {
    if (alive) socket.emit('input', { angle: pointerAngle });
  }, 50);

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function wrapDelta(d, size) {
    d = d % size;
    if (d > size / 2) d -= size;
    if (d < -size / 2) d += size;
    return d;
  }

  function drawGrid() {
    // Fixed to the screen (not the camera/world), but spaced by zoom so it still
    // reads as part of the world shrinking/growing rather than a screen overlay.
    const spacing = 100 * zoom;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = canvas.width / 2 % spacing; x < canvas.width; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
    }
    for (let y = canvas.height / 2 % spacing; y < canvas.height; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();
  }

  function toScreen(x, y, camX, camY) {
    const dx = wrapDelta(x - camX, worldWidth);
    const dy = wrapDelta(y - camY, worldHeight);
    return [canvas.width / 2 + dx * zoom, canvas.height / 2 + dy * zoom];
  }

  function render() {
    requestAnimationFrame(render);
    ctx.fillStyle = '#10131a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const me = myId ? latestState.players.find((p) => p.id === myId) : null;
    const camX = me ? me.segments[0][0] : worldWidth / 2;
    const camY = me ? me.segments[0][1] : worldHeight / 2;

    drawGrid();

    // Food
    for (const [fx, fy, r, color] of latestState.food) {
      const [sx, sy] = toScreen(fx, fy, camX, camY);
      const rz = r * zoom;
      if (sx < -rz - 20 || sx > canvas.width + rz + 20 || sy < -rz - 20 || sy > canvas.height + rz + 20) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx, sy, rz, 0, Math.PI * 2);
      ctx.fill();
    }

    // Snakes
    for (const p of latestState.players) {
      const isMe = p.id === myId;
      const hasEmoji = p.emoji && p.emoji.trim();
      ctx.globalAlpha = p.invulnerable ? 0.55 : 1;

      for (let i = p.segments.length - 1; i >= 0; i--) {
        const [x, y] = p.segments[i];
        const [sx, sy] = toScreen(x, y, camX, camY);
        const isHead = i === 0;
        const radius = (isHead ? 10 : 9) * zoom;
        if (sx < -radius - 20 || sx > canvas.width + radius + 20 || sy < -radius - 20 || sy > canvas.height + radius + 20) continue;

        if (isHead && hasEmoji) {
          ctx.font = Math.round(radius * 2.6) + 'px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(p.emoji, sx, sy);
          continue;
        }

        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
        if (isHead) {
          ctx.strokeStyle = isMe ? '#ffffff' : 'rgba(255,255,255,0.5)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      const head = p.segments[0];
      const [hx, hy] = toScreen(head[0], head[1], camX, camY);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.font = Math.max(9, Math.round(13 * zoom)) + 'px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.name, hx, hy - 20 * zoom);
    }
    ctx.globalAlpha = 1;
  }

  render();
})();
