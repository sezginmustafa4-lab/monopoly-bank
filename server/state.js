import * as logic from './game-logic.js';
import * as persistence from './persistence.js';

let state = logic.createInitialState();
const listeners = new Set();

export async function init() {
  const loaded = await persistence.load();
  if (loaded) {
    // Bağlantılar sunucuyla birlikte kapandı; kimse çevrimiçi değil.
    state = { ...loaded, players: (loaded.players ?? []).map(p => ({ ...p, online: false })) };
  }
}

export function get() { return state; }

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

async function commit(next) {
  // state senkron atanmalı: await'ten sonra atanırsa eşzamanlı işlemler birbirinin sonucunu ezer.
  state = next;
  for (const fn of listeners) fn(state);
  // Diske yazılamasa da işlem geçerlidir; hata dönersek istemci yeniden dener ve iki kez öder.
  try {
    await persistence.save(next);
  } catch (err) {
    console.error('Failed to save game state:', err);
  }
}

export async function reset() {
  await commit(logic.createInitialState());
}

export async function restore(snapshot) {
  if (!snapshot || snapshot.version !== 1 ||
      !['setup', 'active'].includes(snapshot.status) ||
      !snapshot.config || !Array.isArray(snapshot.players) ||
      !Array.isArray(snapshot.transactions) || !Array.isArray(snapshot.diceRolls) ||
      snapshot.players.length > 12 || snapshot.transactions.length > 10000 ||
      snapshot.diceRolls.length > 50) throw new Error('errors.invalidBackup');

  const players = snapshot.players.map((p) => {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' ||
        typeof p.token !== 'string' || !Number.isSafeInteger(p.balance) ||
        typeof p.color !== 'string') throw new Error('errors.invalidBackup');
    return { ...p, online: false };
  });
  const restored = {
    ...snapshot,
    config: { ...logic.createInitialState().config, ...logic.sanitizeConfig(snapshot.config) },
    players,
    transactions: snapshot.transactions,
    diceRolls: snapshot.diceRolls,
  };
  await commit(restored);
}

export async function addPlayer(payload) {
  await commit(logic.addPlayer(state, payload));
}

export async function addDiceRoll(roll) {
  const existing = state.diceRolls ?? [];
  const next = [...existing, roll].slice(-50);
  await commit({ ...state, diceRolls: next });
}

export async function removePlayer(payload) {
  await commit(logic.removePlayer(state, payload));
}

export async function renamePlayer(payload) {
  await commit(logic.renamePlayer(state, payload));
}

export async function startGame(config) {
  // state, logic.startGame başarılı olmadan atanmaz: başarısız başlatma ayarları değiştirmemeli.
  await commit(logic.startGame({ ...state, config: { ...state.config, ...logic.sanitizeConfig(config) } }));
}

export async function updateConfig(patch) {
  await commit({ ...state, config: { ...state.config, ...logic.sanitizeConfig(patch) } });
}

export async function payToBank(payload) {
  const { playerId, amount } = payload;
  logic.assertValidAmount(amount);
  if (amount <= 0) throw new Error('errors.invalidAmount');
  await commit(logic.applyBankerAdjust(state, { playerId, amount: -amount }));
}

export async function transfer(payload) { await commit(logic.applyTransfer(state, payload)); }
export async function passGo(payload) { await commit(logic.applyPassGo(state, payload)); }
export async function bankerAdjust(payload) { await commit(logic.applyBankerAdjust(state, payload)); }
export async function undo(payload) { await commit(logic.undoTransaction(state, payload)); }

export function setOnline(playerId, online) {
  const players = state.players.map(p => p.id === playerId ? { ...p, online } : p);
  state = { ...state, players };
  for (const fn of listeners) fn(state);
}

export function findByToken(token) {
  return state.players.find(p => p.token === token) ?? null;
}
