// ============================================================
// gameLogic.js — Toàn bộ luật chơi Chess Card Game
// KHÔNG phụ thuộc socket, express, hay UI
// ============================================================

const COLORS      = ['red', 'black', 'green', 'blue'];
const PIECE_TYPES = ['tot', 'ma', 'tinh', 'xe', 'hau', 'vua'];
const FUNC_TYPES  = ['cung_ten', 'phong_hau'];

// ── Tạo bộ bài ───────────────────────────────────────────────
function createDeck(numColors = 4) {
  const colors = COLORS.slice(0, numColors);
  const deck = [];
  for (const color of colors) {
    for (let n = 1; n <= 5; n++)
      deck.push({ id: `${color}_tot_${n}`, color, type: 'tot', number: n });
    for (const type of ['ma', 'tinh', 'xe', 'hau', 'vua'])
      for (let n = 1; n <= 3; n++)
        deck.push({ id: `${color}_${type}_${n}`, color, type, number: n });
    deck.push({ id: `${color}_cung_ten`,  color, type: 'cung_ten',  number: null });
    deck.push({ id: `${color}_phong_hau`, color, type: 'phong_hau', number: null });
  }
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealCards(deck, numPlayers) {
  const d = [...deck];
  const hands = Array.from({ length: numPlayers }, () => d.splice(0, 9));
  const board  = Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => [d.splice(0, 1)[0]])
  );
  return { hands, board, drawPile: d };
}

function createGameState(numPlayers, numColors = 4, firstTurn = 0) {
  const deck = shuffle(createDeck(numColors));
  const { hands, board, drawPile } = dealCards(deck, numPlayers);
  return { hands, board, drawPile, currentTurn: firstTurn, numPlayers, numColors };
}

// ── Luật đặt bài ─────────────────────────────────────────────
function canPlace(card, topCard) {
  if (!card || !topCard) return false;
  return card.color === topCard.color || card.type === topCard.type;
}

// ── Ô có thể ăn theo loại quân ───────────────────────────────
function getAttackSquares(card, fr, fc, board, playerSide = 'bottom') {
  if (card.type === 'cung_ten' || card.type === 'phong_hau') return [];
  const inB     = (r, c) => r >= 0 && r < 3 && c >= 0 && c < 3;
  const hasCard = (r, c) => board[r]?.[c]?.length > 0;
  const sq = [];
  switch (card.type) {
    case 'tot': {
      const dirs = { bottom:[[-1,-1],[-1,1]], top:[[1,-1],[1,1]], left:[[-1,1],[1,1]], right:[[-1,-1],[1,-1]] };
      for (const [dr,dc] of (dirs[playerSide]||dirs.bottom)) {
        const r=fr+dr, c=fc+dc;
        if (inB(r,c) && hasCard(r,c)) sq.push([r,c]);
      }
      break;
    }
    case 'ma':
      for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const r=fr+dr, c=fc+dc; if (inB(r,c)&&hasCard(r,c)) sq.push([r,c]);
      }
      break;
    case 'tinh':
      for (const [dr,dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
        let r=fr+dr, c=fc+dc;
        while (inB(r,c)) { if (hasCard(r,c)) sq.push([r,c]); r+=dr; c+=dc; }
      }
      break;
    case 'xe':
      for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        let r=fr+dr, c=fc+dc;
        while (inB(r,c)) { if (hasCard(r,c)) sq.push([r,c]); r+=dr; c+=dc; }
      }
      break;
    case 'hau':
      for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
        let r=fr+dr, c=fc+dc;
        while (inB(r,c)) { if (hasCard(r,c)) sq.push([r,c]); r+=dr; c+=dc; }
      }
      break;
    case 'vua':
      for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
        const r=fr+dr, c=fc+dc; if (inB(r,c)&&hasCard(r,c)) sq.push([r,c]);
      }
      break;
  }
  return sq;
}

// ════════════════════════════════════════════════════════════
// 3 ACT CỦA MỖI LƯỢT
// ACT 1 — refillHand      : bù bài lên đủ 9 (đầu lượt)
// ACT 2 — applyPlaceCard  : đặt 1 lá (tay 9→8)
//          applyAttack /
//          applyDraw /
//          applyCungTenSteal : nhận 1 lá (tay 8→9)
// ACT 3 — advanceTurn     : chuyển lượt (KHÔNG bù bài)
// ════════════════════════════════════════════════════════════

// ACT 1: Bù bài đầu lượt — gọi DUY NHẤT 1 lần khi bắt đầu lượt
function refillHand(gs, playerIdx) {
  while (gs.hands[playerIdx].length < 9 && gs.drawPile.length > 0)
    gs.hands[playerIdx].push(gs.drawPile.shift());
}

// ACT 2a: Đặt bài — tay 9→8
function applyPlaceCard(gs, playerIdx, cardIdx, row, col) {
  const hand = gs.hands[playerIdx];
  if (cardIdx < 0 || cardIdx >= hand.length)
    return { ok: false, error: 'Lá bài không hợp lệ' };
  const card = hand[cardIdx];
  const pile = gs.board[row][col];
  if (pile.length === 0) {
    if (gs.drawPile.length > 0) pile.push(gs.drawPile.shift());
    else return { ok: false, error: 'Ô trống và chồng bài đã hết' };
  }
  if (!canPlace(card, pile[pile.length-1]))
    return { ok: false, error: 'Không thể đặt lá này lên ô đó' };

  hand.splice(cardIdx, 1); // tay 9→8
  pile.push(card);

  if (card.type === 'phong_hau') {
    // Phong Hậu: tự bốc luôn 8→9, kết thúc lượt
    if (gs.drawPile.length > 0) hand.push(gs.drawPile.shift());
    return { ok: true, endTurn: true };
  }
  if (card.type === 'cung_ten') {
    // Cung Tên: tay 8, chờ chọn cướp hay bốc
    return { ok: true, waitForChoice: true };
  }
  // Quân thường: tay 8, chờ chọn ăn hay bốc
  return { ok: true, waitForAction: true };
}

// ACT 2b: Ăn quân — tay 8→9
function applyAttack(gs, playerIdx, row, col) {
  const pile = gs.board[row][col];
  if (!pile || pile.length === 0) return { ok: false, error: 'Ô trống' };
  const taken = pile.pop();
  gs.hands[playerIdx].push(taken); // 8→9
  if (pile.length === 0 && gs.drawPile.length > 0)
    pile.push(gs.drawPile.shift()); // bù ô trống bàn
  return { ok: true, endTurn: true, taken };
}

// ACT 2b: Bốc bài — tay 8→9
function applyDraw(gs, playerIdx) {
  if (gs.drawPile.length === 0) return { ok: false, error: 'Chồng bài đã hết' };
  gs.hands[playerIdx].push(gs.drawPile.shift()); // 8→9
  return { ok: true, endTurn: true };
}

// ACT 2b: Cung Tên cướp bài — tay 8→9
function applyCungTenSteal(gs, playerIdx, targetIdx) {
  const target = gs.hands[targetIdx];
  if (!target || target.length === 0) return { ok: false, error: 'Người đó không còn bài' };
  const stolen = target.splice(Math.floor(Math.random()*target.length), 1)[0];
  gs.hands[playerIdx].push(stolen); // 8→9
  return { ok: true, endTurn: true, stolen };
}

// ACT 3: Kết thúc lượt — chuyển người, bù ô trống bàn
// KHÔNG bù bài tay — bù bài tay là ACT 1 của lượt sau
function advanceTurn(gs, players) {
  // Bù ô trống trên bàn
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (gs.board[r][c].length === 0 && gs.drawPile.length > 0)
        gs.board[r][c].push(gs.drawPile.shift());

  if (gs.drawPile.length === 0) return { gameOver: true };

  // Chuyển lượt, bỏ qua người disconnect
  let tries = 0;
  do {
    gs.currentTurn = (gs.currentTurn + 1) % gs.numPlayers;
    tries++;
  } while (players[gs.currentTurn]?.disconnected && tries < gs.numPlayers);

  return { gameOver: false };
}

// ═══════════════════════════════════════════════════════════════
// COMBO & ĐIỂM SỐ
// ═══════════════════════════════════════════════════════════════

const PENALTY = {
  vua: n => 5+n, hau: n => 4+n, xe: n => 3+n,
  ma:  n => 2+n, tinh: n => 2+n, tot: n => 1+n,
  cung_ten: () => 5, phong_hau: () => 5,
};
function penaltyCard(c) { return (PENALTY[c.type]||(() => 2))(c.number||0); }

function findAllCombos(cards) {
  const combos = [];
  const byColor = {};
  for (const c of cards) {
    if (!byColor[c.color]) byColor[c.color] = [];
    byColor[c.color].push(c);
  }
  for (const [color, group] of Object.entries(byColor)) {
    const jokers  = group.filter(c => c.type === 'phong_hau');
    const normals = group.filter(c => c.type !== 'phong_hau');
    const byType  = {};
    for (const c of normals) {
      if (!byType[c.type]) byType[c.type] = [];
      byType[c.type].push(c);
    }
    for (const t of PIECE_TYPES)
      if (byType[t]) byType[t].sort((a,b) => a.number - b.number);

    for (let N = 1; N <= 3; N++) {
      const matched = []; let jLeft = [...jokers]; let ok = true;
      for (const t of PIECE_TYPES) {
        const found = (byType[t]||[]).find(c => c.number === N);
        if (found) matched.push(found);
        else if (jLeft.length > 0) matched.push(jLeft.shift());
        else { ok=false; break; }
      }
      if (ok && matched.length === 6)
        combos.push({ name:`Bộ hoàng gia hoàn hảo ${color} #${N}`, score:20*N, cardIds:matched.map(c=>c.id) });
    }
    {
      const matched = []; let jLeft = [...jokers];
      for (const t of PIECE_TYPES) {
        const found = (byType[t]||[])[0];
        if (found) matched.push(found);
        else if (jLeft.length > 0) matched.push(jLeft.shift());
      }
      if (matched.length === 6)
        combos.push({ name:`Bộ hoàng gia ${color}`, score:20, cardIds:matched.map(c=>c.id) });
    }
    {
      const tots = byType['tot']||[]; let jLeft=[...jokers]; const used=[...tots];
      while (used.length < 5 && jLeft.length > 0) used.push(jLeft.shift());
      if (used.length >= 5)
        combos.push({ name:`Ngũ Tốt ${color}`, score:15, cardIds:used.slice(0,5).map(c=>c.id) });
    }
    const triScore = { vua:10, hau:9, xe:5, ma:3, tinh:3 };
    for (const [t, sc] of Object.entries(triScore)) {
      const arr = byType[t]||[]; let jLeft=[...jokers]; const used=[...arr];
      while (used.length < 3 && jLeft.length > 0) used.push(jLeft.shift());
      if (used.length >= 3)
        combos.push({ name:`Ba ${t} ${color}`, score:sc, cardIds:used.slice(0,3).map(c=>c.id) });
    }
    {
      const tots = byType['tot']||[];
      for (let i=0; i<=tots.length-3; i++) {
        const [a,b,c2] = tots.slice(i, i+3);
        if (b.number===a.number+1 && c2.number===a.number+2)
          combos.push({ name:`Ba Tốt liên tiếp ${color} ${a.number}-${c2.number}`, score:2, cardIds:[a.id,b.id,c2.id] });
      }
    }
    const pairScore = { vua:5, hau:4, xe:3, ma:2, tinh:2, tot:1 };
    for (const [t, sc] of Object.entries(pairScore)) {
      const arr = byType[t]||[];
      for (let i=0; i<arr.length-1; i++)
        if (arr[i+1].number === arr[i].number+1)
          combos.push({ name:`Đôi ${t} ${color} ${arr[i].number}-${arr[i+1].number}`, score:sc, cardIds:[arr[i].id,arr[i+1].id] });
      if (arr.length >= 1 && jokers.length > 0)
        combos.push({ name:`Đôi ${t}+joker ${color}`, score:sc, cardIds:[arr[0].id, jokers[0].id] });
    }
  }
  return combos;
}

function findBestAssignment(hand) {
  if (!hand || hand.length === 0) return { chosen:[], leftover:[], score:0 };
  const allCombos = findAllCombos(hand);
  allCombos.sort((a,b) => b.score - a.score);
  const used = new Set();
  const chosen = [];
  for (const combo of allCombos) {
    if (combo.cardIds.every(id => !used.has(id))) {
      combo.cardIds.forEach(id => used.add(id));
      chosen.push(combo);
    }
  }
  const leftover = hand.filter(c => !used.has(c.id));
  const score = chosen.reduce((s,c) => s+c.score, 0)
              - leftover.reduce((s,c) => s+penaltyCard(c), 0);
  return { chosen, leftover, score };
}

function scoreHand(hand) { return findBestAssignment(hand).score; }
function canHaBai(hand) {
  if (!hand || hand.length < 9) return false;
  return findBestAssignment(hand).leftover.length === 0;
}

module.exports = {
  refillHand,
  COLORS, PIECE_TYPES, FUNC_TYPES,
  createDeck, shuffle, dealCards, createGameState,
  canPlace, getAttackSquares,
  applyPlaceCard, applyAttack, applyDraw, applyCungTenSteal,
  advanceTurn,
  scoreHand, canHaBai, findBestAssignment, findAllCombos,
};

if (require.main === module) {
  let pass = 0, fail = 0;
  function check(desc, got, expected) {
    if (got === expected) { console.log(`  ✓ ${desc}`); pass++; }
    else { console.log(`  ✗ ${desc}: got ${got}, expected ${expected}`); fail++; }
  }
  console.log('=== Test 3-Act flow ===\n');
  const gs = createGameState(2);
  check('Bắt đầu: tay 9 lá', gs.hands[0].length, 9);
  // ACT 1: bù bài (không thêm vì đã đủ 9)
  refillHand(gs, 0);
  check('ACT1: vẫn 9 lá sau refill', gs.hands[0].length, 9);
  // ACT 2a: đặt bài
  const r = applyPlaceCard(gs, 0, 0, 0, 0);
  if (r.ok && r.endTurn) {
    check('Phong Hậu: tay 9 lá sau đặt+bốc', gs.hands[0].length, 9);
  } else if (r.ok) {
    check('ACT2a: tay 8 lá sau đặt', gs.hands[0].length, 8);
    // ACT 2b: bốc bài
    applyDraw(gs, 0);
    check('ACT2b: tay 9 lá sau bốc', gs.hands[0].length, 9);
  }
  // ACT 3: chuyển lượt
  advanceTurn(gs, [{},{}]);
  check('ACT3: currentTurn chuyển sang 1', gs.currentTurn, 1);
  check('ACT3: tay player 1 VẪN 9 (chưa refill)', gs.hands[1].length, 9);
  // ACT 1 lượt mới
  refillHand(gs, gs.currentTurn);
  check('ACT1 lượt mới: tay 9 lá', gs.hands[gs.currentTurn].length, 9);
  console.log(`\n${pass} passed, ${fail} failed`);
}