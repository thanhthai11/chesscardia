// ============================================================
// socketHandler.js — Xử lý toàn bộ sự kiện Socket.io
// 3-Act flow:
//   ACT1: refillHand đầu lượt (chỉ khi bắt đầu lượt mới)
//   ACT2: place_card → attack/draw/steal (tay 9→8→9)
//   ACT3: advanceTurn (chỉ chuyển lượt, KHÔNG bù bài)
// ============================================================

const {
  createGameState, advanceTurn, refillHand,
  applyPlaceCard, applyAttack, applyDraw, applyCungTenSteal,
  scoreHand, canHaBai, getAttackSquares,
} = require('./gameLogic');

const rooms = {};

function genRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function getRoomOfSocket(socket) {
  const roomId = socket.data.roomId;
  return roomId ? rooms[roomId] : null;
}

function getPlayerIdx(room, socketId) {
  return room.players.findIndex(p => p.socketId === socketId);
}

function buildView(room, myIdx) {
  const gs = room.gameState;
  return {
    roomId:        room.id,
    myIndex:       myIdx,
    phase:         room.phase,
    settings:      room.settings,
    players:       room.players.map((p, i) => ({
      name:         p.name,
      ready:        p.ready,
      isHost:       p.socketId === room.hostId,
      disconnected: p.disconnected || false,
      cardCount:    gs ? gs.hands[i].length : 0,
    })),
    board:         gs?.board          ?? null,
    drawPileCount: gs?.drawPile.length ?? 0,
    currentTurn:   gs?.currentTurn    ?? 0,
    myHand:        gs ? gs.hands[myIdx] : [],
    lastAction:    room.lastAction    ?? null,
    result:        room.result        ?? null,
    pendingAction: (room.pendingAction?.playerIdx === myIdx) ? room.pendingAction : null,
  };
}

// broadcastRoom: chỉ gửi state, KHÔNG bù bài
function broadcastRoom(io, room) {
  room.players.forEach((p, idx) => {
    const sock = io.sockets.sockets.get(p.socketId);
    if (!sock) return;
    sock.emit('room:update', buildView(room, idx));
  });
}

function endGame(io, room, winnerIdx) {
  const gs = room.gameState;
  room.phase = 'result';
  room.pendingAction = null;
  room.lastWinnerId = room.players[winnerIdx]?.socketId;
  room.result = {
    winnerIdx,
    winnerName: room.players[winnerIdx]?.name,
    scores: gs.hands.map((hand, i) => ({
      playerIdx: i,
      name:      room.players[i]?.name,
      score:     scoreHand(hand),
      hand,
    })),
  };
  broadcastRoom(io, room);
}

// ACT3: kết thúc lượt — chuyển người, KHÔNG bù bài
function finishTurn(io, room) {
  room.pendingAction = null;
  const { gameOver } = advanceTurn(room.gameState, room.players);
  if (gameOver) {
    const gs = room.gameState;
    let winnerIdx = 0, maxScore = -Infinity;
    gs.hands.forEach((hand, i) => {
      if (room.players[i]?.disconnected) return;
      const s = scoreHand(hand);
      if (s > maxScore) { maxScore = s; winnerIdx = i; }
    });
    endGame(io, room, winnerIdx);
  } else {
    broadcastRoom(io, room);
  }
}

function registerHandlers(io, socket) {

  socket.on('room:create', ({ name }, cb) => {
    const roomId = genRoomId();
    rooms[roomId] = {
      id: roomId, hostId: socket.id,
      phase: 'lobby', settings: { numColors: 4 },
      players: [{ socketId: socket.id, name: name || 'Người chơi 1', ready: false }],
      gameState: null, lastWinnerId: null,
      lastAction: null, pendingAction: null, result: null,
    };
    socket.join(roomId);
    socket.data.roomId = roomId;
    cb?.({ ok: true, roomId });
    broadcastRoom(io, rooms[roomId]);
  });

  socket.on('room:join', ({ roomId, name }, cb) => {
    const room = rooms[roomId?.toUpperCase()];
    if (!room)                    return cb?.({ ok: false, error: 'Phòng không tồn tại' });
    if (room.phase !== 'lobby')   return cb?.({ ok: false, error: 'Ván đang diễn ra' });
    if (room.players.length >= 4) return cb?.({ ok: false, error: 'Phòng đã đầy (4/4)' });
    const idx = room.players.length;
    room.players.push({ socketId: socket.id, name: name || `Người chơi ${idx+1}`, ready: false });
    socket.join(roomId.toUpperCase());
    socket.data.roomId = roomId.toUpperCase();
    cb?.({ ok: true, roomId: roomId.toUpperCase() });
    broadcastRoom(io, room);
  });

  socket.on('room:ready', ({ ready }) => {
    const room = getRoomOfSocket(socket);
    if (!room) return;
    const p = room.players.find(p => p.socketId === socket.id);
    if (p) { p.ready = ready; broadcastRoom(io, room); }
  });

  socket.on('room:settings', ({ numColors }) => {
    const room = getRoomOfSocket(socket);
    if (!room || room.hostId !== socket.id) return;
    room.settings.numColors = [3, 4].includes(numColors) ? numColors : 4;
    broadcastRoom(io, room);
  });

  socket.on('room:setname', ({ name }) => {
    const room = getRoomOfSocket(socket);
    if (!room || !name?.trim()) return;
    const p = room.players.find(p => p.socketId === socket.id);
    if (p) { p.name = name.trim().slice(0, 20); broadcastRoom(io, room); }
  });

  socket.on('game:start', () => {
    const room = getRoomOfSocket(socket);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return;
    if (!room.players.every(p => p.ready)) return;

    let firstTurn = Math.floor(Math.random() * room.players.length);
    if (room.lastWinnerId) {
      const winIdx = room.players.findIndex(p => p.socketId === room.lastWinnerId);
      if (winIdx >= 0) firstTurn = winIdx;
    }
    room.phase = 'playing';
    room.result = null;
    room.lastAction = null;
    room.pendingAction = null;
    room.gameState = createGameState(room.players.length, room.settings.numColors, firstTurn);
    room.players.forEach(p => { p.ready = false; p.disconnected = false; });
    broadcastRoom(io, room);
  });

  socket.on('game:action', (action, cb) => {
    const room = getRoomOfSocket(socket);
    if (!room || room.phase !== 'playing')
      return cb?.({ ok: false, error: 'Không có ván đang chơi' });

    const playerIdx = getPlayerIdx(room, socket.id);
    if (playerIdx < 0)
      return cb?.({ ok: false, error: 'Bạn không trong phòng này' });

    const gs = room.gameState;

    // ── Đang có pendingAction: ACT2b (ăn/bốc/cướp) ──────────
    // Tay đang 8 lá, chờ nhận thêm 1 → 9
    if (room.pendingAction) {
      const pa = room.pendingAction;
      if (pa.playerIdx !== playerIdx)
        return cb?.({ ok: false, error: 'Chưa đến lượt bạn' });

      if (pa.type === 'choose_action') {
        if (action.type === 'attack') {
          const result = applyAttack(gs, playerIdx, action.row, action.col);
          if (!result.ok) return cb?.({ ok: false, error: result.error });
          room.lastAction = { type: 'attack', player: playerIdx, taken: result.taken, row: action.row, col: action.col };
          cb?.({ ok: true });
          finishTurn(io, room); // ACT3
          return;
        }
        if (action.type === 'draw') {
          const result = applyDraw(gs, playerIdx);
          if (!result.ok) return cb?.({ ok: false, error: result.error });
          room.lastAction = { type: 'draw', player: playerIdx };
          cb?.({ ok: true });
          finishTurn(io, room); // ACT3
          return;
        }
        return cb?.({ ok: false, error: 'Hãy chọn ăn quân hoặc bốc bài' });
      }

      if (pa.type === 'choose_steal') {
        if (action.type === 'cungten_steal') {
          const result = applyCungTenSteal(gs, playerIdx, action.targetIdx);
          if (!result.ok) return cb?.({ ok: false, error: result.error });
          room.lastAction = { type: 'cungten_steal', player: playerIdx, target: action.targetIdx, stolen: result.stolen };
          cb?.({ ok: true });
          finishTurn(io, room); // ACT3
          return;
        }
        if (action.type === 'cungten_draw') {
          const result = applyDraw(gs, playerIdx);
          if (!result.ok) return cb?.({ ok: false, error: result.error });
          room.lastAction = { type: 'draw', player: playerIdx };
          cb?.({ ok: true });
          finishTurn(io, room); // ACT3
          return;
        }
        return cb?.({ ok: false, error: 'Hãy chọn cướp bài hoặc bốc bài' });
      }
    }

    // ── Không có pendingAction: bắt đầu lượt mới ────────────
    if (playerIdx !== gs.currentTurn)
      return cb?.({ ok: false, error: 'Chưa đến lượt bạn' });

    // ACT1: bù bài lên đủ 9 trước khi làm bất cứ điều gì
    refillHand(gs, playerIdx);

    // Hạ bài nếu đủ điều kiện
    if (action.type === 'ha_bai') {
      if (!canHaBai(gs.hands[playerIdx]))
        return cb?.({ ok: false, error: 'Chưa đủ điều kiện hạ bài' });
      room.lastAction = { type: 'ha_bai', player: playerIdx };
      cb?.({ ok: true });
      endGame(io, room, playerIdx);
      return;
    }

    if (action.type !== 'place_card')
      return cb?.({ ok: false, error: 'Hành động không hợp lệ' });

    // ACT2a: đặt bài (tay 9→8)
    const result = applyPlaceCard(gs, playerIdx, action.cardIdx, action.row, action.col);
    if (!result.ok) return cb?.({ ok: false, error: result.error });

    const placedCard = gs.board[action.row][action.col].at(-1);
    room.lastAction = { type: 'place_card', player: playerIdx, card: placedCard, row: action.row, col: action.col };

    if (result.endTurn) {
      // Phong Hậu: đã tự bốc (8→9), kết thúc lượt
      cb?.({ ok: true });
      finishTurn(io, room); // ACT3
      return;
    }

    if (result.waitForChoice) {
      // Cung Tên: tay 8, chờ chọn cướp hay bốc
      room.pendingAction = { type: 'choose_steal', playerIdx, row: action.row, col: action.col, card: placedCard };
      cb?.({ ok: true });
      broadcastRoom(io, room);
      return;
    }

    if (result.waitForAction) {
      // Quân thường: tay 8, tính ô có thể ăn
      const playerSide = ['bottom', 'left', 'top', 'right'][playerIdx % 4];
      const attackSquares = getAttackSquares(placedCard, action.row, action.col, gs.board, playerSide);
      if (attackSquares.length === 0) {
        // Không ăn được → tự bốc (8→9), kết thúc lượt
        const drawResult = applyDraw(gs, playerIdx);
        if (drawResult.ok) room.lastAction = { type: 'draw', player: playerIdx };
        cb?.({ ok: true });
        finishTurn(io, room); // ACT3
      } else {
        // Có thể ăn → chờ player chọn ăn hay bốc
        room.pendingAction = {
          type: 'choose_action',
          playerIdx,
          row: action.row, col: action.col,
          card: placedCard,
          attackSquares,
        };
        cb?.({ ok: true });
        broadcastRoom(io, room);
      }
      return;
    }
  });

  socket.on('disconnect', () => {
    const room = getRoomOfSocket(socket);
    if (!room) return;
    const p = room.players.find(p => p.socketId === socket.id);
    if (!p) return;
    p.disconnected = true;

    if (room.hostId === socket.id) {
      const next = room.players.find(p => !p.disconnected);
      if (next) room.hostId = next.socketId;
    }
    io.to(room.id).emit('room:player_left', { name: p.name });

    if (room.phase === 'playing') {
      const gs = room.gameState;
      const disconnIdx = getPlayerIdx(room, socket.id);

      // Người disconnect đang ở giữa lượt (pendingAction) → bốc tự động
      if (room.pendingAction?.playerIdx === disconnIdx) {
        applyDraw(gs, disconnIdx);
        room.pendingAction = null;
      }

      if (gs.currentTurn === disconnIdx) {
        const { gameOver } = advanceTurn(gs, room.players);
        if (gameOver) {
          let winnerIdx = 0, maxScore = -Infinity;
          gs.hands.forEach((hand, i) => {
            if (room.players[i]?.disconnected) return;
            const s = scoreHand(hand);
            if (s > maxScore) { maxScore = s; winnerIdx = i; }
          });
          endGame(io, room, winnerIdx);
          return;
        }
      }

      const activePlayers = room.players.filter(p => !p.disconnected);
      if (activePlayers.length < 2) {
        const winnerIdx = room.players.findIndex(p => !p.disconnected);
        if (winnerIdx >= 0) endGame(io, room, winnerIdx);
        return;
      }
    }
    broadcastRoom(io, room);
  });
}

module.exports = { registerHandlers };