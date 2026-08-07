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
  const colorSwatchesEl = document.getElementById('color-swatches');
  const leaderboardEl = document.getElementById('leaderboard');
  const leaderboardListEl = document.getElementById('leaderboard-list');
  const hudEl = document.getElementById('hud');
  const scoreDisplayEl = document.getElementById('score-display');
  const deathHeadingEl = document.getElementById('death-heading');
  const countdownScreen = document.getElementById('countdown-screen');
  const countdownNumberEl = document.getElementById('countdown-number');

  const DEATH_MESSAGES = ["noooo you died", "oof couldn't keep up", "rip, better luck next time"];

  const COLORS = ['#4cc9f0', '#f72585', '#ffd166', '#06d6a0', '#b5179e', '#f77f00', '#90e0ef', '#ef476f'];
  let selectedColor = COLORS[0];
  COLORS.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'swatch' + (i === 0 ? ' selected' : '');
    el.style.background = c;
    el.addEventListener('click', () => {
      selectedColor = c;
      document.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
      el.classList.add('selected');
    });
    colorSwatchesEl.appendChild(el);
  });

  let myId = null;
  let worldWidth = 3000;
  let worldHeight = 2000;
  let latestState = { players: [], food: [], leaderboard: [] };
  let alive = false;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function storedName() {
    return localStorage.getItem('snake_name') || '';
  }
  nameInput.value = storedName();

  function doJoin() {
    const name = nameInput.value.trim().slice(0, 16) || 'Player';
    localStorage.setItem('snake_name', name);
    socket.emit('join', { name, color: selectedColor });
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
  });

  socket.on('died', (data) => {
    alive = false;
    myId = null;
    deathHeadingEl.textContent = DEATH_MESSAGES[Math.floor(Math.random() * DEATH_MESSAGES.length)];
    finalScoreEl.textContent = `Final score: ${data.score}`;
    leaderboardEl.classList.add('hidden');
    hudEl.classList.add('hidden');
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
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
      setPointerFromClient(e.touches[0].clientX, e.touches[0].clientY);
    }
    e.preventDefault();
  }, { passive: false });

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
    // Fixed to the screen (not the camera/world) so the background never appears to drift.
    const spacing = 100;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < canvas.width; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
    }
    for (let y = 0; y < canvas.height; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();
  }

  function toScreen(x, y, camX, camY) {
    const dx = wrapDelta(x - camX, worldWidth);
    const dy = wrapDelta(y - camY, worldHeight);
    return [canvas.width / 2 + dx, canvas.height / 2 + dy];
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
      if (sx < -20 || sx > canvas.width + 20 || sy < -20 || sy > canvas.height + 20) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Snakes
    for (const p of latestState.players) {
      const isMe = p.id === myId;
      ctx.globalAlpha = p.invulnerable ? 0.55 : 1;

      for (let i = p.segments.length - 1; i >= 0; i--) {
        const [x, y] = p.segments[i];
        const [sx, sy] = toScreen(x, y, camX, camY);
        if (sx < -30 || sx > canvas.width + 30 || sy < -30 || sy > canvas.height + 30) continue;
        const isHead = i === 0;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, isHead ? 10 : 9, 0, Math.PI * 2);
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
      ctx.font = '13px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.name, hx, hy - 20);
    }
    ctx.globalAlpha = 1;
  }

  render();
})();
