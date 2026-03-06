// ============================================================
// ui.js — Render toàn bộ giao diện từ state S
// ============================================================
import { S, canPlace, getAttackSquares, getPlayerSide, findBestAssignment, canHaBai } from './game.js';

// ── Inject drag & drop CSS ────────────────────────────────────
(function injectDragCSS() {
  const style = document.createElement('style');
  style.textContent = `
    #my-hand .card { cursor: grab; transition: transform 0.15s, opacity 0.15s; user-select: none; }
    #my-hand .card img { pointer-events: none; draggable: false; }
    #my-hand .card.dragging { opacity: 0.4; transform: scale(0.95); cursor: grabbing; }
    #my-hand .card.drag-over { transform: translateY(-8px) scale(1.05); outline: 2px solid #facc15; }
  `;
  document.head.appendChild(style);
})();

// ── Hằng hiển thị ────────────────────────────────────────────
export const LABELS = { tot:'Tốt', ma:'Mã', tinh:'Tịnh', xe:'Xe', hau:'Hậu', vua:'Vua', cung_ten:'Cung Tên', phong_hau:'Phong Hậu' };
export const COLOR_VI = { red:'Đỏ', black:'Đen', green:'Xanh', blue:'Vàng' };
const PIECE_ICON = { tot:'♟', ma:'♞', tinh:'♝', xe:'♜', hau:'♛', vua:'♚', cung_ten:'🏹', phong_hau:'👑' };

// ── Toast ─────────────────────────────────────────────────────
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2800);
}

// ── Card element ──────────────────────────────────────────────
export function makeCardEl(card, opts = {}) {
  const el = document.createElement('div');
  if (!card || card.type === 'back') {
    el.className = 'card card-back';
    const img = document.createElement('img');
    img.src = 'assets/matsau.jpg';
    img.onerror = () => { el.textContent = '🂠'; img.remove(); };
    el.appendChild(img);
    return el;
  }
  el.className = `card card-${card.color}${opts.selected?' selected':''}${opts.canPlace?' can-place':''}${opts.attack?' can-attack':''}`;
  el.dataset.id = card.id;

  const imgName = card.number ? `${card.color}_${card.type}_${card.number}` : `${card.color}_${card.type}`;
  const img = document.createElement('img');
  img.src = `assets/cards/${imgName}.jpg`;
  img.alt = `${LABELS[card.type]||card.type} ${card.number||''}`;
  img.draggable = false;
  img.onerror = () => {
    img.remove();
    el.innerHTML = `<span class="card-icon">${PIECE_ICON[card.type]||'?'}</span><span class="card-name">${LABELS[card.type]||card.type}${card.number?' '+card.number:''}</span>`;
  };
  el.appendChild(img);
  return el;
}

// ── Render bàn cờ 3x3 ─────────────────────────────────────────
export function renderBoard(onSlotClick) {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  if (!S.board) return;

  boardEl.style.transform = '';

  const selCard = S.selCard;
  const inSelectSlot = S.phase === 'select-slot' && selCard;

  // Tính thứ tự render ô theo góc nhìn của người chơi
  // Chiều kim đồng hồ: 0=bottom, 1=left, 2=top, 3=right
  // Mỗi người thấy bàn xoay sao cho "phía mình" luôn ở dưới
  function getCell(viewR, viewC, myIdx) {
    switch (myIdx % 4) {
      case 0: return [viewR, viewC];         // bottom: bình thường
      case 1: return [viewC, 2-viewR];       // left: CCW 90°
      case 2: return [2-viewR, 2-viewC];     // top: 180°
      case 3: return [2-viewC, viewR];       // right: CW 90°
      default: return [viewR, viewC];
    }
  }

  for (let viewR = 0; viewR < 3; viewR++) {
    for (let viewC = 0; viewC < 3; viewC++) {
      const [r, c] = getCell(viewR, viewC, S.myIndex);
      const pile = S.board[r][c];
      const top  = pile[pile.length - 1];
      const isAttack = S.attackSquares.some(([ar,ac]) => ar===r && ac===c);
      const canPlaceHere = inSelectSlot && (top ? canPlace(selCard, top) : true);

      const cell = document.createElement('div');
      cell.className = `board-cell${isAttack?' can-attack':''}${canPlaceHere?' can-place':''}`;
      cell.dataset.r = r; cell.dataset.c = c;

      if (top) {
        const cardEl = makeCardEl(top, { attack: isAttack });
        cell.appendChild(cardEl);
        if (pile.length > 1) {
          const badge = document.createElement('span');
          badge.className = 'pile-count';
          badge.textContent = pile.length;
          cell.appendChild(badge);
        }
      } else {
        cell.classList.add('empty');
        cell.textContent = '·';
      }

      cell.addEventListener('click', () => onSlotClick(r, c));
      boardEl.appendChild(cell);
    }
  }
}

// ── Render tay bài của mình ───────────────────────────────────
export function renderMyHand(onCardClick, onReorder) {
  const handEl = document.getElementById('my-hand');
  handEl.innerHTML = '';
  const hand = S.hands[S.myIndex] || [];

  hand.forEach((card, i) => {
    const isSelected = S.selCardIdx === i;
    const el = makeCardEl(card, { selected: isSelected });
    el.addEventListener('click', () => onCardClick(i));

    // ── Drag & Drop để sắp xếp lá bài ──
    el.draggable = true;
    el.dataset.idx = i;

    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(i));
      setTimeout(() => el.classList.add('dragging'), 0);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('#my-hand .card').forEach(c => c.classList.remove('drag-over'));
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      document.querySelectorAll('#my-hand .card').forEach(c => c.classList.remove('drag-over'));
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const toIdx = i;
      if (fromIdx === toIdx || isNaN(fromIdx)) return;
      if (onReorder) onReorder(fromIdx, toIdx);
    });

    handEl.appendChild(el);
  });

  // Nút hạ bài
  const btnHa = document.getElementById('btn-ha-bai');
  if (btnHa) {
    const canHa = canHaBai(hand);
    btnHa.classList.toggle('hidden', !canHa);
    if (canHa) btnHa.title = 'Tất cả lá tạo được combo — ấn để hạ bài thắng!';
  }
}

// ── Render tay bài đối thủ (úp) ──────────────────────────────
export function renderOpponentHand(position, playerIdx) {
  const handEl = document.getElementById(`hand-${position}`);
  if (!handEl) return;
  handEl.innerHTML = '';
  const count = S.hands[playerIdx]?.length || 0;
  for (let i = 0; i < count; i++) {
    handEl.appendChild(makeCardEl(null)); // úp mặt sau
  }
}

// ── Render toàn bộ zones ──────────────────────────────────────
export function renderZones() {
  const positions = ['bottom','left','top','right'];
  const numP = S.numPlayers;

  // Ẩn tất cả zones đối thủ trước
  ['top','left','right'].forEach(pos => {
    const zone = document.getElementById(`zone-${pos}`);
    if (zone) zone.classList.add('hidden');
  });

  // Hiện zones theo số người chơi
  for (let i = 0; i < numP; i++) {
    const rel = ((i - S.myIndex) + numP) % numP;
    const pos = positions[rel];
    const player = S.players[i];
    if (!player) continue;

    // Tên người chơi
    const nameEl = document.getElementById(`name-${pos}`);
    if (nameEl) {
      const turnIndicator = S.currentTurn === i ? ' 🎯' : '';
      const disconnected  = player.disconnected ? ' (mất kết nối)' : '';
      nameEl.textContent = (player.name || `P${i+1}`) + turnIndicator + disconnected;
    }

    if (rel === 0) continue; // bottom = mình, không cần zone riêng

    const zone = document.getElementById(`zone-${pos}`);
    if (zone) {
      zone.classList.remove('hidden');
      renderOpponentHand(pos, i);
    }
  }
}

// ── Render turn banner ────────────────────────────────────────
export function renderTurnBanner() {
  const banner = document.getElementById('turn-banner');
  if (!banner) return;
  if (S.currentTurn === S.myIndex) {
    banner.innerHTML = '🎯 <span class="your-turn">Đến lượt bạn!</span>';
    banner.className = 'turn-banner my-turn';
  } else {
    const name = S.players[S.currentTurn]?.name || 'Người chơi';
    banner.innerHTML = `⏳ Lượt của <strong>${name}</strong>`;
    banner.className = 'turn-banner';
  }
}

// ── Render phase text ─────────────────────────────────────────
export function renderPhaseText() {
  const el = document.getElementById('phase-text');
  if (!el) return;
  const msgs = {
    'select-card':   'Chọn lá bài để đặt',
    'select-slot':   'Chọn ô để đặt bài',
    'select-action': 'Ăn quân (ô đỏ) hoặc bốc bài',
    'select-steal':  'Chọn đối thủ để cướp bài',
    'waiting':       'Đang chờ...',
    'result':        '',
  };
  el.textContent = msgs[S.phase] || '';

  // Draw pile highlight
  const pile = document.getElementById('draw-pile-btn');
  if (pile) pile.classList.toggle('active', S.phase === 'select-action');

  // Draw count
  const cnt = document.getElementById('draw-count');
  if (cnt) cnt.textContent = S.drawPileCount;
}

// ── Render tất cả ────────────────────────────────────────────
export function renderAll(onCardClick, onSlotClick, onReorder) {
  renderBoard(onSlotClick);
  renderMyHand(onCardClick, onReorder);
  renderZones();
  renderTurnBanner();
  renderPhaseText();
}

// ── Inspector overlay ─────────────────────────────────────────
export function openInspector(r, c) {
  const pile = S.board?.[r]?.[c];
  if (!pile || pile.length === 0) { toast('Ô này trống'); return; }

  const overlay  = document.getElementById('inspector-overlay');
  const cardsEl  = document.getElementById('inspector-cards');
  cardsEl.innerHTML = '';

  // Hiển thị từ dưới lên trên
  [...pile].reverse().forEach((card, i) => {
    const el = makeCardEl(card);
    if (i === 0) el.classList.add('top-card');
    cardsEl.appendChild(el);
  });
  overlay.classList.remove('hidden');
}

// ── Cung Tên overlay ──────────────────────────────────────────
export function openCungTen(onSteal, onDraw) {
  const overlay   = document.getElementById('cungten-overlay');
  const targetsEl = document.getElementById('cungten-targets');
  targetsEl.innerHTML = '';

  S.players.forEach((p, i) => {
    if (i === S.myIndex || p.disconnected || !S.hands[i]?.length) return;
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.textContent = `🏹 Cướp từ ${p.name} (${S.hands[i].length} lá)`;
    btn.onclick = () => { overlay.classList.add('hidden'); onSteal(i); };
    targetsEl.appendChild(btn);
  });

  document.getElementById('btn-cungten-draw').onclick = () => {
    overlay.classList.add('hidden');
    onDraw();
  };
  overlay.classList.remove('hidden');
}

// ── Result overlay ────────────────────────────────────────────
export function showResult(onPlayAgain, onMenu) {
  if (!S.result) return;
  const overlay = document.getElementById('result-overlay');
  document.getElementById('result-winner').textContent = `🏆 ${S.result.winnerName} chiến thắng!`;

  const scoresEl = document.getElementById('result-scores');
  scoresEl.innerHTML = '';

  S.result.scores.forEach(({ name, score, chosen, leftover }) => {
    const row = document.createElement('div');
    row.className = 'result-row';

    const combosHTML = chosen.map(c =>
      `<span class="combo-tag">${c.name} (+${c.score})</span>`
    ).join('');
    const leftoverHTML = leftover.map(c =>
      `<span class="leftover-tag">${PIECE_ICON[c.type]||'?'} ${LABELS[c.type]||c.type}${c.number?' '+c.number:''}</span>`
    ).join('');

    row.innerHTML = `
      <div class="result-name">${name}</div>
      <div class="result-score ${score>=0?'pos':'neg'}">${score>=0?'+':''}${score} điểm</div>
      <div class="result-combos">${combosHTML}</div>
      ${leftover.length ? `<div class="result-leftover">Lẻ: ${leftoverHTML}</div>` : ''}
    `;
    scoresEl.appendChild(row);
  });

  document.getElementById('btn-play-again').onclick = () => { overlay.classList.add('hidden'); onPlayAgain(); };
  document.getElementById('btn-back-to-menu').onclick = () => { overlay.classList.add('hidden'); onMenu(); };
  overlay.classList.remove('hidden');
}

// ── Action feed ───────────────────────────────────────────────
export function pushFeed(action, players) {
  const feed = document.getElementById('action-feed');
  if (!feed) return;
  const who = players[action.player]?.name || 'Bot';
  const card = action.card || action.taken;
  const cardStr = card ? `${PIECE_ICON[card.type]||'?'} ${LABELS[card.type]||card.type}${card.number?' '+card.number:''}` : '';
  const BOARD_POS = [['Trái-Trên','Giữa-Trên','Phải-Trên'],['Trái-Giữa','Trung Tâm','Phải-Giữa'],['Trái-Dưới','Giữa-Dưới','Phải-Dưới']];
  const pos = action.row != null ? BOARD_POS[action.row]?.[action.col] : '';

  let msg = '';
  if (action.type === 'place_card') msg = `<b>${who}</b> đặt ${cardStr}${pos?' vào '+pos:''}`;
  else if (action.type === 'attack') msg = `<b>${who}</b> ăn ${cardStr}${pos?' tại '+pos:''}`;
  else if (action.type === 'draw') msg = `<b>${who}</b> bốc 1 lá`;
  else if (action.type === 'cungten_steal') msg = `<b>${who}</b> 🏹 cướp từ ${players[action.target]?.name||'?'}`;
  else if (action.type === 'ha_bai') msg = `<b>${who}</b> 🏆 HẠ BÀI!`;
  if (!msg) return;

  const item = document.createElement('div');
  item.className = 'feed-item';
  item.innerHTML = msg;
  feed.insertBefore(item, feed.firstChild);
  while (feed.children.length > 5) feed.removeChild(feed.lastChild);
  setTimeout(() => item.remove(), 4000);
}

// ── Lobby helpers ─────────────────────────────────────────────
export function showScreen(screenId) {
  ['screen-menu','screen-offline','screen-waiting'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', id !== screenId);
  });
}

export function renderWaitingRoom(view) {
  document.getElementById('wr-roomid').textContent = view.roomId;

  // Settings (chỉ host thấy)
  const settingsRow = document.getElementById('settings-row');
  if (settingsRow) settingsRow.classList.toggle('hidden', !view.players[view.myIndex]?.isHost);
  document.getElementById('btn-3colors')?.classList.toggle('active', view.settings?.numColors === 3);
  document.getElementById('btn-4colors')?.classList.toggle('active', view.settings?.numColors === 4);

  // Player slots
  const slotsEl = document.getElementById('player-slots');
  slotsEl.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = view.players[i];
    const slot = document.createElement('div');
    slot.className = 'player-slot' + (p ? '' : ' empty');
    if (p) {
      slot.innerHTML = `
        <span class="slot-avatar">${['♛','♜','♞','♝'][i]}</span>
        <span class="slot-name">${p.name}${i===view.myIndex?' (bạn)':''}</span>
        ${p.isHost ? '<span class="badge host">Chủ phòng</span>' : ''}
        ${p.ready  ? '<span class="badge ready">✓ Sẵn sàng</span>' : '<span class="badge wait">Chờ...</span>'}
      `;
    } else {
      slot.innerHTML = '<span class="slot-avatar" style="opacity:.3">—</span><span class="slot-name" style="opacity:.3">Chờ...</span>';
    }
    slotsEl.appendChild(slot);
  }

  // Nút bắt đầu (chỉ host)
  const startBtn = document.getElementById('btn-start-online');
  const isHost   = view.players[view.myIndex]?.isHost;
  const allReady = view.players.every(p => p.ready);
  const canStart = isHost && allReady && view.players.length >= 2;
  if (startBtn) {
    startBtn.classList.toggle('hidden', !isHost);
    startBtn.disabled = !canStart;
    startBtn.textContent = canStart
      ? '▶ Bắt đầu!'
      : `▶ Bắt đầu (${view.players.filter(p=>p.ready).length}/${view.players.length} sẵn sàng)`;
  }
}

export function renderBotDifficultyRows(numBots) {
  const container = document.getElementById('bot-difficulty-rows');
  container.innerHTML = '';
  for (let i = 0; i < numBots; i++) {
    const row = document.createElement('div');
    row.className = 'setting-row';
    row.innerHTML = `
      <label>Bot ${i+1}:</label>
      <div class="btn-group-small">
        <button class="btn-diff ${i===0?'active':''}" data-bot="${i}" data-diff="easy">Dễ</button>
        <button class="btn-diff" data-bot="${i}" data-diff="medium">Trung bình</button>
        <button class="btn-diff" data-bot="${i}" data-diff="hard">Khó</button>
      </div>
    `;
    container.appendChild(row);
  }
}