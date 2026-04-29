// ══════════════════════════════════════════════════════════════
//  Regicide – Multiplayer (Firebase Realtime Database)
//  Requires: firebase-config.js loaded before this file.
// ══════════════════════════════════════════════════════════════

// ── Firebase init ──────────────────────────────────────────────
let _db = null;
function _ensureFirebase() {
  if (_db) return;
  if (!window.FIREBASE_CONFIG) throw new Error('firebase-config.js missing.');
  if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
  _db = firebase.database();
}

// ── Global multiplayer state ───────────────────────────────────
window.mpRoom = null;   // active MultiplayerRoom (checked by game.js dispatchers)
let _mpSel = new Set(); // card positions selected by local player

// ── MultiplayerRoom ────────────────────────────────────────────
class MultiplayerRoom {
  constructor() {
    _ensureFirebase();
    this.db       = _db;
    this.code     = null;
    this.myIndex  = null;      // 0 or 1
    this.myUID    = Math.random().toString(36).slice(2, 10);
    this.game     = new RegicideGame2P();
    this.names    = ['Player 1', 'Player 2'];
    this._ref     = null;
    this._cbRef   = null;
  }

  _genCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let c = '';
    for (let i = 0; i < 6; i++) c += A[Math.floor(Math.random() * A.length)];
    return c;
  }

  async createRoom(name) {
    this.code = this._genCode();
    this.myIndex = 0;
    this.names[0] = name;
    this._ref = this.db.ref('rooms/' + this.code);
    await this._ref.set({ status: 'lobby', p0: { name, uid: this.myUID }, p1: null, gs: null });
    return this.code;
  }

  async joinRoom(code, name) {
    code = code.trim().toUpperCase();
    this._ref = this.db.ref('rooms/' + code);
    const snap = await this._ref.get();
    if (!snap.exists())         throw new Error('Room not found. Check the code.');
    const d = snap.val();
    if (d.status !== 'lobby')   throw new Error('Game already started.');
    if (d.p1)                   throw new Error('Room is full.');
    this.code = code;
    this.myIndex = 1;
    this.names[0] = d.p0?.name || 'Player 1';
    this.names[1] = name;
    await this._ref.child('p1').set({ name, uid: this.myUID });
    return d;
  }

  subscribe(cb) {
    if (this._cbRef) { this._ref.off('value', this._cbRef); }
    this._cbRef = this._ref.on('value', snap => cb(snap.val()));
  }

  unsubscribe() {
    if (this._cbRef) { this._ref.off('value', this._cbRef); this._cbRef = null; }
  }

  async startGame() {
    this.game.reset();
    await this._ref.update({ status: 'playing', gs: serializeGameState(this.game) });
  }

  async push() {
    await this._ref.child('gs').set(serializeGameState(this.game));
  }

  loadFrom(d) {
    if (d.p0) this.names[0] = d.p0.name || 'Player 1';
    if (d.p1) this.names[1] = d.p1.name || 'Player 2';
    deserializeGameState(d.gs, this.game);
  }

  isMyTurn() {
    const s = this.game.state;
    return !!s && !s.gameOver && s.currentPlayer === this.myIndex;
  }
}

// ── Lobby UI ───────────────────────────────────────────────────
function initLobby() {
  _resetLobbyUI();
}

function _resetLobbyUI() {
  const nameEl = document.getElementById('mp-name');
  if (nameEl) nameEl.value = '';
  const codeEl = document.getElementById('mp-code-input');
  if (codeEl) codeEl.value = '';
  _mpStatusHide();
  _mpRoomCodeHide();
  window.mpRoom = null;
}

async function mpCreate() {
  const name = (document.getElementById('mp-name').value.trim() || 'Player 1').slice(0, 16);
  _mpStatusSet('Connecting…');
  try {
    window.mpRoom = new MultiplayerRoom();
    const code = await window.mpRoom.createRoom(name);

    _mpRoomCodeShow(code);
    _mpStatusSet('⏳ Waiting for Player 2… Share the code above!');

    window.mpRoom.subscribe(d => {
      if (!d) return;
      if (d.status === 'playing' && d.gs) {
        // Game started (either by us after P1 joined, or already running)
        window.mpRoom.loadFrom(d);
        _mpEnterGame();
      } else if (d.p1 && d.status === 'lobby') {
        // P1 just joined – P0 starts the game
        _mpStatusSet(`✅ ${d.p1.name} joined! Starting…`);
        window.mpRoom.names[1] = d.p1.name;
        window.mpRoom.startGame().catch(e => _mpStatusSet('❌ ' + e.message));
      }
    });
  } catch (e) {
    _mpStatusSet('❌ ' + e.message);
    window.mpRoom = null;
  }
}

async function mpJoin() {
  const name = (document.getElementById('mp-name').value.trim() || 'Player 2').slice(0, 16);
  const code = document.getElementById('mp-code-input').value.trim();
  if (!code) { _mpStatusSet('Enter a room code first.'); return; }
  _mpStatusSet('Connecting…');
  try {
    window.mpRoom = new MultiplayerRoom();
    await window.mpRoom.joinRoom(code, name);
    _mpStatusSet('⏳ Joined! Waiting for the host to start…');

    window.mpRoom.subscribe(d => {
      if (!d) return;
      if (d.status === 'playing' && d.gs) {
        window.mpRoom.loadFrom(d);
        _mpEnterGame();
      } else if (d.status === 'abandoned') {
        _mpStatusSet('❌ The host left the room.');
        window.mpRoom.unsubscribe();
        window.mpRoom = null;
      }
    });
  } catch (e) {
    _mpStatusSet('❌ ' + e.message);
    window.mpRoom = null;
  }
}

function _mpStatusSet(msg) {
  const el = document.getElementById('mp-status');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}
function _mpStatusHide() {
  document.getElementById('mp-status')?.classList.add('hidden');
}
function _mpRoomCodeShow(code) {
  const el = document.getElementById('mp-room-display');
  if (!el) return;
  el.textContent = code;
  el.classList.remove('hidden');
}
function _mpRoomCodeHide() {
  document.getElementById('mp-room-display')?.classList.add('hidden');
}

// ── Enter game ─────────────────────────────────────────────────
function _mpEnterGame() {
  const room = window.mpRoom;
  if (!room) return;
  room.unsubscribe();

  // Re-subscribe for in-game state updates
  room.subscribe(d => {
    if (!d || !d.gs) return;
    if (d.status === 'abandoned') { _mpHandleAbandoned(); return; }
    room.loadFrom(d);
    _mpSel.clear();
    mpRenderAll();
  });

  // Switch to game screen
  showScreen('screen-game');

  // Override back button and overlay button for multiplayer cleanup
  const backBtn = document.querySelector('#screen-game .back-btn');
  if (backBtn) backBtn.onclick = mpLeave;
  const overlayBtn = document.querySelector('#overlay-box button');
  if (overlayBtn) overlayBtn.onclick = mpLeave;

  // Show opponent hand section, hide jester counter
  document.getElementById('opp-hand-section').classList.remove('hidden');
  document.getElementById('info-jesters').style.display = 'none';

  _mpSel.clear();
  mpRenderAll();
}

function mpLeave() {
  if (!confirm('Leave the game?')) return;
  _mpCleanup(true);
  goToMenu();
}

function _mpHandleAbandoned() {
  alert('Your opponent left the game.');
  _mpCleanup(false);
  goToMenu();
}

function _mpCleanup(sendAbandoned) {
  const room = window.mpRoom;
  if (room) {
    room.unsubscribe();
    if (sendAbandoned) room._ref?.child('status').set('abandoned').catch(() => {});
    window.mpRoom = null;
  }
  // Restore solo UI defaults
  document.getElementById('opp-hand-section').classList.add('hidden');
  document.getElementById('info-jesters').style.display = '';
  const backBtn = document.querySelector('#screen-game .back-btn');
  if (backBtn) backBtn.onclick = goToMenu;
  const overlayBtn = document.querySelector('#overlay-box button');
  if (overlayBtn) overlayBtn.onclick = goToMenu;
  document.getElementById('overlay').classList.add('hidden');
}

// ── 2P Render ──────────────────────────────────────────────────
function mpRenderAll() {
  const room = window.mpRoom;
  if (!room || !room.game.state) return;
  const s = room.game.state;

  // Temporarily bridge to solo render functions that use game.state / game.log
  const savedState = game.state, savedLog = game.log;
  game.state = s; game.log = room.game.log;

  renderEnemy();
  renderInfo();
  renderLog();

  game.state = savedState; game.log = savedLog;

  _mpRenderMyHand(s);
  _mpRenderOppHand(s);
  _mpRenderPhaseBanner(s);
  _mpRenderActionBar(s);
  _mpCheckGameOver(s);
}

function _mpRenderMyHand(s) {
  const room   = window.mpRoom;
  const myHand = s.hands[room.myIndex];
  const myTurn = room.isMyTurn();
  const zone   = document.getElementById('hand-zone');
  zone.innerHTML = '';

  myHand.forEach((card, i) => {
    const isRed = !card.isJester && (card.suit === SUIT.HEARTS || card.suit === SUIT.DIAMONDS);
    const colorCls = card.isJester ? '' : (isRed ? ' card-red' : ' card-black');
    const el = document.createElement('div');
    el.className = 'card hand-card' + colorCls
      + (_mpSel.has(i) ? ' selected' : '')
      + (!myTurn ? ' mp-locked' : '');
    if (card.isJester) el.className += ' card-jester';
    if (myTurn) el.onclick = () => mpToggleCard(i);
    el.innerHTML = `
      <div class="card-corner top-left">
        <div class="cr-rank">${card.rankStr}</div>
        <div class="cr-suit ${isRed?'red':'black'}">${card.isJester?'🃏':card.suitSym}</div>
      </div>
      <div class="card-center">
        <div class="card-center-suit ${isRed?'red':'black'}">${card.isJester?'🃏':card.suitSym}</div>
      </div>
      <div class="card-corner bottom-right rot180">
        <div class="cr-rank">${card.rankStr}</div>
        <div class="cr-suit ${isRed?'red':'black'}">${card.isJester?'🃏':card.suitSym}</div>
      </div>`;
    zone.appendChild(el);
  });

  document.getElementById('hand-count').textContent = myHand.length;
  const lbl = document.querySelector('.hand-label');
  if (lbl) lbl.textContent = `${room.names[room.myIndex]} (you) – ${myHand.length} cards`;
}

function _mpRenderOppHand(s) {
  const room    = window.mpRoom;
  const oppIdx  = 1 - room.myIndex;
  const oppHand = s.hands[oppIdx];
  const oppName = room.names[oppIdx];

  const lbl  = document.getElementById('opp-hand-label');
  const zone = document.getElementById('opp-hand-zone');
  if (!lbl || !zone) return;

  lbl.textContent = `${oppName} – ${oppHand.length} cards`;
  zone.innerHTML = oppHand.map(() => '<div class="card-back"></div>').join('');
}

function _mpRenderPhaseBanner(s) {
  const room   = window.mpRoom;
  const myTurn = room.isMyTurn();
  const names  = room.names;
  const el     = document.getElementById('phase-text');

  if (s.gameOver) {
    el.textContent = s.won ? '🎉 Victory!' : '💀 Defeat';
  } else if (s.phase === 'discard') {
    if (s.currentPlayer === room.myIndex)
      el.textContent = `⚠ Discard cards to cover ${s.dmgToCoer} damage`;
    else
      el.textContent = `⏳ ${names[s.currentPlayer]} is covering damage…`;
  } else {
    el.textContent = myTurn
      ? 'Your turn – select card(s) and Play, or Yield'
      : `⏳ Waiting for ${names[s.currentPlayer]}…`;
  }

  document.getElementById('phase-banner').className =
    'phase-banner' + (s.phase === 'discard' && s.currentPlayer === room.myIndex ? ' phase-discard' : '');
}

function _mpRenderActionBar(s) {
  const room   = window.mpRoom;
  const myTurn = room.isMyTurn();
  const sel    = [..._mpSel];

  const btnPlay  = document.getElementById('btn-play');
  const btnYield = document.getElementById('btn-yield');
  const btnJest  = document.getElementById('btn-jester');
  const btnClr   = document.getElementById('btn-clear');

  btnJest.classList.add('hidden');

  if (!myTurn || s.gameOver) {
    [btnPlay, btnYield, btnClr].forEach(b => b.classList.add('hidden'));
    return;
  }
  [btnPlay, btnClr].forEach(b => b.classList.remove('hidden'));

  if (s.phase === 'play') {
    btnPlay.textContent = 'Play Card(s)';
    const valid = sel.length > 0 && room.game.isValidPlay(sel);
    btnPlay.className = 'action-btn play-btn' + (valid ? '' : ' dimmed');
    const canYield = room.game.canYield();
    btnYield.classList.toggle('hidden', !canYield);
  } else {
    btnPlay.textContent = 'Discard Selected';
    const valid = sel.length > 0 && room.game.isValidDiscard(sel);
    btnPlay.className = 'action-btn discard-act-btn' + (valid ? '' : ' dimmed');
    btnYield.classList.add('hidden');
  }
}

function _mpCheckGameOver(s) {
  if (!s.gameOver) { document.getElementById('overlay').classList.add('hidden'); return; }
  const overlay = document.getElementById('overlay');
  const title   = document.getElementById('overlay-title');
  const sub     = document.getElementById('overlay-sub');
  overlay.classList.remove('hidden');
  if (s.won) {
    overlay.className   = 'overlay-win';
    title.textContent   = 'Gold Victory!';
    sub.textContent     = 'You and your ally defeated all monarchs!';
  } else {
    overlay.className   = 'overlay-loss';
    title.textContent   = 'Defeat!';
    sub.textContent     = 'The corruption spreads… Try again together!';
  }
}

// ── 2P Actions ─────────────────────────────────────────────────
function mpToggleCard(i) {
  if (!window.mpRoom || !window.mpRoom.isMyTurn()) return;
  if (_mpSel.has(i)) _mpSel.delete(i); else _mpSel.add(i);
  _mpRenderMyHand(window.mpRoom.game.state);
  _mpRenderActionBar(window.mpRoom.game.state);
}

function mpOnPlay() {
  const room = window.mpRoom;
  if (!room || !room.isMyTurn()) return;
  const s   = room.game.state;
  const sel = [..._mpSel].sort((a, b) => a - b);
  if (!sel.length) { showToast('Select at least one card first.'); return; }

  if (s.phase === 'play') {
    if (!room.game.isValidPlay(sel)) {
      showToast('Invalid combination. Check combo rules (same rank, total ≤ 10).');
      return;
    }
    _mpSel.clear();
    room.game.playCards(sel);
  } else {
    if (!room.game.isValidDiscard(sel)) {
      const h     = s.hands[room.myIndex];
      const total = sel.reduce((sum, i) => sum + h[i].value, 0);
      showToast(`Not enough: ${total} < ${s.dmgToCoer} required.`);
      return;
    }
    _mpSel.clear();
    room.game.discardCards(sel);
  }

  mpRenderAll();
  room.push().catch(e => showToast('Sync error: ' + e.message));
}

function mpOnYield() {
  const room = window.mpRoom;
  if (!room || !room.isMyTurn()) return;
  if (!room.game.canYield()) { showToast("Can't yield – opponent already yielded."); return; }
  room.game.yieldTurn();
  _mpSel.clear();
  mpRenderAll();
  room.push().catch(e => showToast('Sync error: ' + e.message));
}
