// ============================================================
//  Regicide – Full JavaScript Game Engine + UI
// ============================================================

// ── Constants ────────────────────────────────────────────────
const SUIT = { HEARTS: 0, DIAMONDS: 1, CLUBS: 2, SPADES: 3 };
const SUIT_SYM  = ['♥', '♦', '♣', '♠'];
const SUIT_NAME = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
const SUIT_COLOR= ['red', 'red', 'black', 'black'];

// Sort priority: C → H → S → D  (indices match SUIT enum values)
const SUIT_SORT_ORDER = { 2: 0, 0: 1, 3: 2, 1: 3 };  // CLUBS, HEARTS, SPADES, DIAMONDS

const HAND_VAL = { 1:1, 2:2, 3:3, 4:4, 5:5, 6:6, 7:7, 8:8, 9:9, 10:10, 11:10, 12:15, 13:20 };
const RANK_LABEL = { 1:'A', 11:'J', 12:'Q', 13:'K' };
const ENEMY_STATS = {
  11: { attack:10, health:20 },
  12: { attack:15, health:30 },
  13: { attack:20, health:40 },
};

// ── Card ─────────────────────────────────────────────────────
class Card {
  constructor(rank, suit, isJester = false) {
    this.rank = rank;
    this.suit = suit;
    this.isJoster = isJester; // keep typo-free externally
    this.isJester = isJester;
  }
  get value() { return this.isJester ? 0 : HAND_VAL[this.rank]; }
  get isAC()   { return this.rank === 1 && !this.isJester; }
  get isEnemy(){ return [11,12,13].includes(this.rank) && !this.isJester; }
  get label()  {
    if (this.isJester) return 'Joker';
    const r = RANK_LABEL[this.rank] || String(this.rank);
    return r + SUIT_SYM[this.suit];
  }
  get rankStr(){ return RANK_LABEL[this.rank] || String(this.rank); }
  get suitSym(){ return SUIT_SYM[this.suit]; }
  get color()  { return SUIT_COLOR[this.suit]; }
}

// ── Deck builders ─────────────────────────────────────────────
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeCastleDeck() {
  const jacks  = [0,1,2,3].map(s => new Card(11, s));
  const queens = [0,1,2,3].map(s => new Card(12, s));
  const kings  = [0,1,2,3].map(s => new Card(13, s));
  shuffle(jacks); shuffle(queens); shuffle(kings);
  return [...jacks, ...queens, ...kings];
}

function makeTavernDeck() {
  const cards = [];
  for (let s = 0; s < 4; s++) {
    cards.push(new Card(1, s));          // Ace (AC)
    for (let r = 2; r <= 10; r++) cards.push(new Card(r, s));
  }
  return shuffle(cards);  // no jesters for solo
}

// ── Game Engine ───────────────────────────────────────────────
class RegicideGame {
  constructor() { this.state = null; this.log = []; }

  reset() {
    const castle = makeCastleDeck();
    const tavern = makeTavernDeck();
    const hand   = [];
    for (let i = 0; i < 8 && tavern.length > 0; i++) hand.push(tavern.shift());
    const enemy  = castle.shift();

    this.state = {
      castle, tavern, discard: [],
      hand, enemy,
      totalDamage:   0,
      shield:        0,
      immunePool:    0,  // spades vs immune enemy before jester
      jesterImmune:  false,
      playedVsEnemy: [],
      phase:         'play',
      dmgToCoer:     0,
      jestersAvail:  2,
      jestersUsed:   0,
      gameOver:      false,
      won:           false,
      victoryType:   null,
    };
    this.log = [];
    this._addLog('⚔ Game started! First enemy: ' + enemy.label);
    return this.state;
  }

  // ── Validation ──────────────────────────────────────────────
  isValidPlay(positions) {
    const s = this.state;
    const cards = positions.map(i => s.hand[i]);
    const n = cards.length;
    if (n === 0) return false;
    if (positions.some(i => i >= s.hand.length)) return false;
    if (n === 1) return true;

    if (n === 2) {
      if (cards.some(c => c.isJester)) return false;
      if (cards.some(c => c.isAC))     return true;   // AC + any non-Jester
      return cards[0].rank === cards[1].rank
          && cards[0].value + cards[1].value <= 10;
    }
    // n >= 3: pure combo only
    if (cards.some(c => c.isJester || c.isAC)) return false;
    if (!cards.every(c => c.rank === cards[0].rank)) return false;
    return cards.reduce((s, c) => s + c.value, 0) <= 10;
  }

  isValidDiscard(positions) {
    const s = this.state;
    if (positions.some(i => i >= s.hand.length)) return false;
    const total = positions.reduce((sum, i) => sum + s.hand[i].value, 0);
    return total >= s.dmgToCoer;
  }

  canYield() { return true; } // solo: always

  // ── Actions ─────────────────────────────────────────────────
  playCards(positions) {
    const s = this.state;
    if (s.gameOver || s.phase !== 'play') return;

    const cards = positions.map(i => s.hand[i]);
    // Remove from hand (reverse order)
    positions.slice().sort((a,b) => b - a).forEach(i => s.hand.splice(i, 1));
    cards.forEach(c => s.playedVsEnemy.push(c));

    const atk = cards.reduce((sum, c) => sum + c.value, 0);
    this._addLog(`▶ You play ${cards.map(c=>c.label).join(' + ')}  [ATK ${atk}]`);

    // Handle Jester from hand (if played solo, not expected, but handle gracefully)
    if (cards.length === 1 && cards[0].isJester) {
      s.jesterImmune = true;
      if (s.enemy.suit === SUIT.SPADES) {
        s.shield += s.immunePool;
        s.immunePool = 0;
      }
      this._addLog('🃏 Jester played – enemy immunity cancelled!');
      this._advanceTurn();
      return;
    }

    // Step 2: suit powers
    this._applySuitPowers(cards, atk);

    // Step 3: damage
    const immuneSuit = s.jesterImmune ? null : s.enemy.suit;
    const clubsActive = cards.some(c => c.suit === SUIT.CLUBS) && immuneSuit !== SUIT.CLUBS;
    const damage = clubsActive ? atk * 2 : atk;
    s.totalDamage += damage;
    const hpMax = ENEMY_STATS[s.enemy.rank].health;
    this._addLog(`💥 Damage ${damage}  (total ${s.totalDamage}/${hpMax})`);

    if (s.totalDamage >= hpMax) {
      this._defeatEnemy(s.totalDamage === hpMax);
      return;
    }

    // Step 4
    this._beginStep4();
  }

  yieldTurn() {
    const s = this.state;
    if (s.gameOver || s.phase !== 'play') return;
    this._addLog('⏭ You yield.');
    this._beginStep4();
  }

  useJesterPower() {
    const s = this.state;
    if (s.jestersAvail <= 0 || s.gameOver) return;
    s.jestersUsed++;
    s.jestersAvail--;
    s.discard.push(...s.hand.splice(0));
    const drawn = [];
    while (drawn.length < 8 && s.tavern.length > 0) drawn.push(s.tavern.shift());
    s.hand.push(...drawn);
    this._addLog(`🃏 Jester token used (${s.jestersUsed}/2). Hand refreshed → ${drawn.length} cards drawn.`);
  }

  discardCards(positions) {
    const s = this.state;
    if (s.gameOver || s.phase !== 'discard') return;

    // Check total
    const cards = positions.map(i => s.hand[i]);
    const total = cards.reduce((sum, c) => sum + c.value, 0);
    if (total < s.dmgToCoer) {
      this._addLog(`❌ Need ${s.dmgToCoer} but selected only ${total}. Pick more cards.`);
      return;
    }

    positions.slice().sort((a,b) => b - a).forEach(i => {
      s.discard.push(s.hand.splice(i, 1)[0]);
    });
    this._addLog(`🗑 Discarded ${cards.map(c=>c.label).join(' + ')} (value ${total}) to cover ${s.dmgToCoer} damage.`);
    s.dmgToCoer = 0;
    s.phase = 'play';
    this._addLog('— Next turn —');
  }

  cannotCoverDamage() {
    const s = this.state;
    const totalHandValue = s.hand.reduce((sum, c) => sum + c.value, 0);
    return totalHandValue < s.dmgToCoer;
  }

  // ── Internal ─────────────────────────────────────────────────
  _applySuitPowers(cards, atk) {
    const s = this.state;
    const immuneSuit = s.jesterImmune ? null : s.enemy.suit;
    const suits = new Set(cards.filter(c => !c.isJester).map(c => c.suit));

    // Hearts – heal (before Diamonds)
    if (suits.has(SUIT.HEARTS) && immuneSuit !== SUIT.HEARTS) {
      this._heartsHeal(atk);
      this._addLog(`♥ Hearts: moved ${atk} cards from discard to bottom of tavern.`);
    }
    // Diamonds – draw
    if (suits.has(SUIT.DIAMONDS) && immuneSuit !== SUIT.DIAMONDS) {
      const drawn = this._diamondsDraw(atk);
      this._addLog(`♦ Diamonds: drew ${drawn} card(s).`);
    }
    // Clubs – note (applied in caller)
    if (suits.has(SUIT.CLUBS)) {
      if (immuneSuit === SUIT.CLUBS) {
        this._addLog('♣ Clubs: enemy immune – no double damage.');
      } else {
        this._addLog('♣ Clubs: double damage!');
      }
    }
    // Spades – shield
    if (suits.has(SUIT.SPADES)) {
      if (immuneSuit === SUIT.SPADES) {
        s.immunePool += atk;
        this._addLog(`♠ Spades: enemy immune – ${atk} shield queued for Jester.`);
      } else {
        s.shield += atk;
        this._addLog(`♠ Spades: shield +${atk} (total ${s.shield}).`);
      }
    }
  }

  _heartsHeal(n) {
    const s = this.state;
    if (s.discard.length === 0) return;
    shuffle(s.discard);
    const taken = s.discard.splice(0, n);
    s.tavern.push(...taken);  // bottom of tavern
  }

  _diamondsDraw(n) {
    const s = this.state;
    let drawn = 0;
    while (drawn < n && s.tavern.length > 0 && s.hand.length < 8) {
      s.hand.push(s.tavern.shift());
      drawn++;
    }
    return drawn;
  }

  _defeatEnemy(exact) {
    const s = this.state;
    this._addLog(`🏆 ${s.enemy.label} DEFEATED!`);
    if (exact) {
      s.tavern.unshift(s.enemy);
      this._addLog('  (Exact damage – enemy placed on top of Tavern deck.)');
    } else {
      s.discard.push(s.enemy);
    }
    s.discard.push(...s.playedVsEnemy.splice(0));
    s.totalDamage  = 0;
    s.shield       = 0;
    s.immunePool   = 0;
    s.jesterImmune = false;

    if (s.castle.length === 0) {
      s.gameOver = true;
      s.won      = true;
      if      (s.jestersUsed === 0) s.victoryType = 'Gold';
      else if (s.jestersUsed === 1) s.victoryType = 'Silver';
      else                          s.victoryType = 'Bronze';
      this._addLog(`🎉 YOU WIN! ${s.victoryType} Victory (${s.jestersUsed} Jester(s) used).`);
      return;
    }

    s.enemy = s.castle.shift();
    this._addLog(`Next enemy: ${s.enemy.label} (HP ${ENEMY_STATS[s.enemy.rank].health}, ATK ${ENEMY_STATS[s.enemy.rank].attack})`);
    s.phase = 'play';
  }

  _beginStep4() {
    const s = this.state;
    const atk = Math.max(0, ENEMY_STATS[s.enemy.rank].attack - s.shield);
    if (atk <= 0) {
      this._addLog('🛡 Enemy attack fully shielded – no damage taken.');
      this._addLog('— Next turn —');
      return;
    }
    const handValue = s.hand.reduce((sum, c) => sum + c.value, 0);
    if (handValue < atk && s.hand.length > 0) {
      s.gameOver = true;
      s.won = false;
      this._addLog(`💀 DEFEAT: Can't cover ${atk} damage (hand value ${handValue}).`);
      return;
    }
    if (s.hand.length === 0 && atk > 0) {
      s.gameOver = true;
      s.won = false;
      this._addLog(`💀 DEFEAT: Empty hand, enemy attacks for ${atk}.`);
      return;
    }
    s.phase    = 'discard';
    s.dmgToCoer = atk;
    this._addLog(`⚠ Enemy attacks for ${atk}! Discard cards with total value ≥ ${atk}.`);
  }

  _advanceTurn() {
    this.state.phase = 'play';
    this._addLog('— Next turn —');
  }

  _addLog(msg) {
    this.log.unshift(msg);  // newest first
    if (this.log.length > 100) this.log.pop();
  }

  get effectiveAtk() {
    const s = this.state;
    return Math.max(0, ENEMY_STATS[s.enemy.rank].attack - s.shield);
  }
}

// ── UI State ─────────────────────────────────────────────────
const game = new RegicideGame();
let selectedPositions = new Set();
let gameMode     = 'interactive';
let numPlayers   = 1;
let sortAscending = true;  // → ascending (C H S D, low→high)

// ── Sort ──────────────────────────────────────────────────────
function sortHand() {
  const s = game.state;
  if (!s) return;
  s.hand.sort((a, b) => {
    // Jokers always last regardless of direction
    if (a.isJester && !b.isJester) return 1;
    if (!a.isJester && b.isJester) return -1;
    if (a.isJester && b.isJester) return 0;

    const suitDiff = SUIT_SORT_ORDER[a.suit] - SUIT_SORT_ORDER[b.suit];
    if (suitDiff !== 0) return sortAscending ? suitDiff : -suitDiff;

    const valDiff = a.value - b.value;
    return sortAscending ? valDiff : -valDiff;
  });
}

function toggleSort() {
  sortAscending = !sortAscending;
  const btn = document.getElementById('btn-sort');
  btn.textContent = sortAscending ? '→' : '←';
  btn.title = sortAscending ? 'Ordine ascendente (C H S D, ↑ valore)' : 'Ordine discendente (D S H C, ↓ valore)';
  selectedPositions.clear();
  sortHand();
  renderHand();
  renderActionBar();
}

// ── Landing screen ───────────────────────────────────────────
function selectMode(mode) {
  gameMode = mode;
  document.querySelectorAll('.mode-btn:not([disabled])').forEach(b => b.classList.remove('selected'));
  document.getElementById('btn-' + mode).classList.add('selected');
}

function selectPlayers(n) {
  numPlayers = n;
  document.querySelectorAll('.player-btn:not([disabled])').forEach(b => b.classList.remove('selected'));
  document.getElementById('btn-p' + n).classList.add('selected');
}

function startGame() {
  showScreen('screen-game');
  game.reset();
  selectedPositions.clear();
  sortAscending = true;
  const btn = document.getElementById('btn-sort');
  if (btn) { btn.textContent = '→'; }
  renderAll();
}

function goToMenu() {
  showScreen('screen-landing');
  document.getElementById('overlay').classList.add('hidden');
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Render ────────────────────────────────────────────────────
function renderAll() {
  sortHand();        // maintain sort after every state change
  renderEnemy();
  renderHand();
  renderInfo();
  renderLog();
  renderActionBar();
  renderPhaseBanner();
  checkGameOver();
}

function renderEnemy() {
  const s = game.state;
  if (!s) return;
  const e = s.enemy;
  const isRed = e.suit === SUIT.HEARTS || e.suit === SUIT.DIAMONDS;

  document.getElementById('ec-rank-top').textContent = e.rankStr;
  document.getElementById('ec-rank-bot').textContent = e.rankStr;
  document.getElementById('ec-suit').textContent     = e.suitSym;
  document.getElementById('ec-suit').className       = 'card-suit-big ' + (isRed ? 'red' : 'black');
  document.getElementById('enemy-card').className    = 'card enemy-card ' + (isRed ? 'card-red' : 'card-black');

  const hpMax  = ENEMY_STATS[e.rank].health;
  const hpLeft = Math.max(0, hpMax - s.totalDamage);
  const pct    = (hpLeft / hpMax) * 100;
  document.getElementById('stat-hp').textContent      = `${hpLeft}/${hpMax}`;
  document.getElementById('hp-bar').style.width       = pct + '%';
  document.getElementById('hp-bar').className         = 'hp-bar' + (pct <= 30 ? ' low' : pct <= 60 ? ' mid' : '');
  document.getElementById('stat-atk').textContent     = game.effectiveAtk + (s.shield > 0 ? ` (🛡${s.shield})` : '');
  document.getElementById('stat-shield').textContent  = s.shield;

  const immuneBox = document.getElementById('stat-immunity-box');
  const immuneVal = document.getElementById('stat-immunity');
  if (s.jesterImmune) {
    immuneBox.style.opacity = '0.4';
    immuneVal.textContent   = '✗';
  } else {
    immuneBox.style.opacity = '1';
    immuneVal.textContent   = e.suitSym;
    immuneVal.className     = 'stat-value ' + SUIT_COLOR[e.suit];
  }
}

function renderHand() {
  const s = game.state;
  const zone = document.getElementById('hand-zone');
  zone.innerHTML = '';
  if (!s) return;

  s.hand.forEach((card, i) => {
    const el    = document.createElement('div');
    const isRed = !card.isJester && (card.suit === SUIT.HEARTS || card.suit === SUIT.DIAMONDS);
    // card-red/card-black set --card-color CSS variable used by .cr-rank
    const colorClass = card.isJester ? '' : (isRed ? ' card-red' : ' card-black');
    el.className = 'card hand-card' + colorClass + (selectedPositions.has(i) ? ' selected' : '');
    if (card.isJester) el.className += ' card-jester';
    el.onclick = () => toggleCard(i);

    el.innerHTML = `
      <div class="card-corner top-left">
        <div class="cr-rank">${card.rankStr}</div>
        <div class="cr-suit ${isRed ? 'red' : 'black'}">${card.isJester ? '🃏' : card.suitSym}</div>
      </div>
      <div class="card-center">
        <div class="card-center-suit ${isRed ? 'red' : 'black'}">${card.isJester ? '🃏' : card.suitSym}</div>
      </div>
      <div class="card-corner bottom-right rot180">
        <div class="cr-rank">${card.rankStr}</div>
        <div class="cr-suit ${isRed ? 'red' : 'black'}">${card.isJester ? '🃏' : card.suitSym}</div>
      </div>
    `;
    zone.appendChild(el);
  });

  document.getElementById('hand-count').textContent = s.hand.length;
}

function renderInfo() {
  const s = game.state;
  if (!s) return;
  document.getElementById('info-castle').textContent  = `Castle: ${s.castle.length}`;
  document.getElementById('info-tavern').textContent  = `Tavern: ${s.tavern.length}`;
  document.getElementById('info-discard').textContent = `Discard: ${s.discard.length}`;
  document.getElementById('info-jesters').textContent = `🃏 ×${s.jestersAvail}`;
}

function renderLog() {
  const el = document.getElementById('game-log');
  el.innerHTML = game.log.map(l => `<div class="log-line">${escHtml(l)}</div>`).join('');
}

function renderPhaseBanner() {
  const s = game.state;
  if (!s) return;
  const el = document.getElementById('phase-text');
  if (s.gameOver) {
    el.textContent = s.won ? '🎉 Victory!' : '💀 Defeat';
  } else if (s.phase === 'discard') {
    el.textContent = `⚠ Discard cards to cover ${s.dmgToCoer} damage`;
  } else {
    el.textContent = 'Your turn – select card(s) and Play, or Yield';
  }
  document.getElementById('phase-banner').className =
    'phase-banner' + (s.phase === 'discard' ? ' phase-discard' : '');
}

function renderActionBar() {
  const s = game.state;
  if (!s) return;

  const isPlay    = s.phase === 'play';
  const isDiscard = s.phase === 'discard';
  const sel       = [...selectedPositions];

  const btnPlay  = document.getElementById('btn-play');
  const btnYield = document.getElementById('btn-yield');
  const btnJest  = document.getElementById('btn-jester');
  const btnClr   = document.getElementById('btn-clear');

  if (isPlay) {
    btnPlay.textContent  = 'Play Card(s)';
    btnPlay.className    = 'action-btn play-btn' + (sel.length > 0 && game.isValidPlay(sel) ? '' : ' dimmed');
    btnYield.classList.remove('hidden');
    btnJest.classList.toggle('hidden', s.jestersAvail <= 0);
    btnJest.textContent = `🃏 Jester (${s.jestersAvail})`;
  } else {
    btnPlay.textContent  = 'Discard Selected';
    btnPlay.className    = 'action-btn discard-act-btn' + (sel.length > 0 && game.isValidDiscard(sel) ? '' : ' dimmed');
    btnYield.classList.add('hidden');
    btnJest.classList.toggle('hidden', s.jestersAvail <= 0);
    btnJest.textContent = `🃏 Jester (${s.jestersAvail})`;
  }

  if (s.gameOver) {
    btnPlay.classList.add('hidden');
    btnYield.classList.add('hidden');
    btnJest.classList.add('hidden');
    btnClr.classList.add('hidden');
  } else {
    btnPlay.classList.remove('hidden');
    btnClr.classList.remove('hidden');
  }
}

function checkGameOver() {
  const s = game.state;
  if (!s || !s.gameOver) return;
  const overlay   = document.getElementById('overlay');
  const title     = document.getElementById('overlay-title');
  const sub       = document.getElementById('overlay-sub');
  overlay.classList.remove('hidden');
  if (s.won) {
    overlay.className = 'overlay-win';
    title.textContent = `${s.victoryType} Victory!`;
    const descMap = { Gold: 'Perfect – no Jesters used!', Silver: '1 Jester used.', Bronze: '2 Jesters used.' };
    sub.textContent = descMap[s.victoryType] || '';
  } else {
    overlay.className = 'overlay-loss';
    title.textContent = 'Defeat!';
    sub.textContent   = 'The corruption spreads... Try again!';
  }
}

// ── User interactions ─────────────────────────────────────────
function toggleCard(idx) {
  const s = game.state;
  if (!s || s.gameOver) return;
  if (selectedPositions.has(idx)) selectedPositions.delete(idx);
  else                             selectedPositions.add(idx);
  renderHand();
  renderActionBar();
}

function clearSelection() {
  selectedPositions.clear();
  renderHand();
  renderActionBar();
}

function onPlay() {
  const s = game.state;
  if (!s || s.gameOver) return;
  const sel = [...selectedPositions].sort((a,b) => a - b);
  if (sel.length === 0) { showToast('Select at least one card first.'); return; }

  if (s.phase === 'play') {
    if (!game.isValidPlay(sel)) {
      showToast('Invalid combination. Check combo rules (same rank, total ≤ 10).');
      return;
    }
    selectedPositions.clear();
    game.playCards(sel);
  } else {
    if (!game.isValidDiscard(sel)) {
      const total = sel.reduce((sum, i) => sum + s.hand[i].value, 0);
      showToast(`Not enough: ${total} < ${s.dmgToCoer} required.`);
      return;
    }
    selectedPositions.clear();
    game.discardCards(sel);
  }
  renderAll();
}

function onYield() {
  const s = game.state;
  if (!s || s.gameOver || s.phase !== 'play') return;
  game.yieldTurn();
  selectedPositions.clear();
  renderAll();
}

function onJester() {
  const s = game.state;
  if (!s || s.gameOver || s.jestersAvail <= 0) return;
  if (!confirm(`Use a Jester token? Your entire hand will be discarded and you'll draw up to 8 new cards.\n(${s.jestersAvail} token(s) remaining)`)) return;
  game.useJesterPower();
  selectedPositions.clear();
  renderAll();
}

// ── Helpers ───────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let toastTimer;
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = 'toast visible';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2800);
}
