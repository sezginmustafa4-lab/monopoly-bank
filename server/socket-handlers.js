import * as state from './state.js';

export function attachSockets(io) {
  // Aynı oyuncunun açık bağlantı sayısı; yalnızca sonuncu kapanınca çevrimdışı olur.
  const openConnections = new Map();
  state.subscribe((s) => io.emit('state', s));

  io.on('connection', (socket) => {
    const { token, role } = socket.handshake.auth ?? {};
    let playerId = null;

    if (role === 'banker') {
      socket.join('bankers');
    } else if (token) {
      const player = state.findByToken(token);
      if (player) {
        playerId = player.id;
        openConnections.set(playerId, (openConnections.get(playerId) ?? 0) + 1);
        state.setOnline(playerId, true);
      }
    }

    socket.emit('state', state.get());

    const wrap = (fn) => async (payload, ack) => {
      try {
        await fn(payload);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        const known = typeof err?.message === 'string' && err.message.startsWith('errors.');
        // Beklenmeyen hatanın ham metni istemciye gitmez; yalnızca sunucu logunda kalır.
        if (!known) console.error('Unexpected socket handler error:', err);
        if (typeof ack === 'function') ack({ ok: false, error: known ? err.message : 'errors.unknownError' });
      }
    };

    const requireBanker = (fn) => async (payload) => {
      if (role !== 'banker') throw new Error('errors.unauthorized');
      await fn(payload);
    };

    socket.on('roll-dice', wrap(async () => {
      if (!playerId) throw new Error('errors.rollDiceOnly');
      const roll = {
        id: 'd_' + Math.random().toString(36).slice(2, 10),
        playerId,
        dice: [
          1 + Math.floor(Math.random() * 6),
          1 + Math.floor(Math.random() * 6),
        ],
        ts: Date.now(),
      };
      await state.addDiceRoll(roll);
      io.emit('dice-rolled', roll);
    }));

    socket.on('add-player', wrap(requireBanker(state.addPlayer)));
    socket.on('remove-player', wrap(requireBanker(state.removePlayer)));
    socket.on('rename-player', wrap(async (p) => {
      if (!playerId) throw new Error('errors.unauthorized');
      await state.renamePlayer({ playerId, name: p?.name });
    }));
    socket.on('start-game', wrap(requireBanker(state.startGame)));
    socket.on('update-config', wrap(requireBanker(state.updateConfig)));
    socket.on('pay-to-bank', wrap(async (p) => {
      if (!playerId && role !== 'banker') throw new Error('errors.unauthorized');
      await state.payToBank({ playerId: playerId ?? p.playerId, amount: p.amount });
    }));
    socket.on('transfer', wrap(async (p) => {
      if (!playerId && role !== 'banker') throw new Error('errors.unauthorized');
      await state.transfer({ ...p, fromId: playerId ?? p.fromId });
    }));
    socket.on('pass-go', wrap(async (p) => {
      if (role !== 'banker') throw new Error('errors.passGoBankerOnly');
      if (!p?.playerId) throw new Error('errors.playerIdRequired');
      await state.passGo({ playerId: p.playerId });
    }));
    socket.on('banker-adjust', wrap(requireBanker(state.bankerAdjust)));
    socket.on('undo', wrap(requireBanker(state.undo)));
    socket.on('reset', wrap(requireBanker(state.reset)));
    socket.on('restore-state', wrap(requireBanker(state.restore)));

    socket.on('disconnect', () => {
      if (!playerId) return;
      const remaining = (openConnections.get(playerId) ?? 1) - 1;
      if (remaining > 0) {
        openConnections.set(playerId, remaining);
        return;
      }
      openConnections.delete(playerId);
      state.setOnline(playerId, false);
    });
  });
}
