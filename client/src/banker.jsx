import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import toast, { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import './i18n.js';
import { matchFilter } from './history.js';
import { useSocket } from './useSocket.js';
import { emit, formatRelative, getQuickAmounts, DEFAULT_QUICK_AMOUNTS, MAX_NAME_LENGTH } from './socket.js';
import { QrCode } from './QrCode.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';
import { useTheme } from './useTheme.js';
import { ConnectionBadge } from './ConnectionBadge.jsx';
import { DiceNotification } from './DiceNotification.jsx';
import { DiceList } from './DiceHistory.jsx';
import { GameTimer } from './GameTimer.jsx';
import { LanguageSwitcher } from './LanguageSwitcher.jsx';
import { copyText } from './clipboard.js';
import {
  QrCode as QrIcon, Dices, Plus, Minus, RotateCcw, MoreVertical, Trash2, Copy, Check,
  Settings, UserPlus, Users, PlayCircle,
  Receipt, ArrowLeftRight, ArrowDownToLine, ArrowUpFromLine, Flag, Undo2,
  Wallet, ListChecks, Rows2, ExternalLink,
} from 'lucide-react';
import '../index.css';

const PLAYER_COLORS = [
  '#3b82f6', '#ef4444', '#eab308', '#22c55e', '#a855f7', '#06b6d4', '#ec4899', '#f97316',
];

function fmt(n, currency) {
  return `${n.toLocaleString()}${currency}`;
}

function App() {
  useTheme();
  const { socket, state, connected, diceRoll } = useSocket({ role: 'banker' });
  const [lanUrl, setLanUrl] = useState(location.origin);
  const [activeRoll, setActiveRoll] = useState(null);
  const backupChecked = useRef(false);
  const restoreInProgress = useRef(false);

  useEffect(() => {
    fetch('/api/server-info')
      .then(r => r.json())
      .then(d => { if (d.lanUrl) setLanUrl(d.lanUrl); })
      .catch(() => {});
  }, []);

  useEffect(() => { if (diceRoll) setActiveRoll(diceRoll); }, [diceRoll]);
  useEffect(() => {
    if (!state || backupChecked.current) return;
    backupChecked.current = true;
    const backupKey = 'monopoly-bank-auto-backup-v1';
    let backup = null;
    try {
      const raw = localStorage.getItem(backupKey);
      if (raw) backup = JSON.parse(raw);
    } catch {
      toast.error('Tablet yedeği okunamadı.');
    }
    const serverIsEmpty = state.players.length === 0 && state.transactions.length === 0;
    const backupHasGame = backup?.version === 1 &&
      Array.isArray(backup.players) && backup.players.length > 0;
    if (serverIsEmpty && backupHasGame &&
        window.confirm('Sunucuda kayıtlı oyun bulunamadı. Bu tabletteki son yedek geri yüklensin mi?')) {
      restoreInProgress.current = true;
      emit(socket, 'restore-state', backup)
        .then(() => toast.success('Oyun tablet yedeğinden geri yüklendi.'))
        .catch(() => { restoreInProgress.current = false; toast.error('Yedek geri yüklenemedi.'); });
      return;
    }
    try { localStorage.setItem(backupKey, JSON.stringify(state)); }
    catch { toast.error('Otomatik yedek kaydedilemedi. Tablet tarayıcı alanını kontrol edin.'); }
  }, [state, socket]);

  useEffect(() => {
    if (!state || !backupChecked.current) return;
    try { localStorage.setItem('monopoly-bank-auto-backup-v1', JSON.stringify(state)); }
    catch { toast.error('Otomatik yedek kaydedilemedi. Tablet tarayıcı alanını kontrol edin.'); }
  }, [state]);


  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="loading loading-spinner loading-lg text-primary"></span>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-[1600px] mx-auto">
      <Toaster position="top-right" />
      <Header connected={connected} lanUrl={lanUrl} socket={socket} state={state} />
      {state.status === 'setup'
        ? <SetupView socket={socket} state={state} lanUrl={lanUrl} />
        : <ActiveView socket={socket} state={state} lanUrl={lanUrl} />}
      <DiceNotification
        roll={activeRoll}
        players={state.players}
        onClose={() => setActiveRoll(null)}
      />
    </div>
  );
}

function Header({ connected, lanUrl, socket, state }) {
  const { t } = useTranslation();
  const onReset = async () => {
    if (!confirm(t('banker.resetGameConfirm'))) return;
    try { await emit(socket, 'reset'); toast.success(t('banker.gameReset')); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
      <h1 className="text-2xl md:text-3xl font-black flex items-center gap-2">
        <span className="text-3xl md:text-4xl">🏦</span> {t('common.appName')}
      </h1>
      <div className="flex items-center gap-2 flex-wrap">
        <code className="text-xs opacity-70 bg-base-300 px-2 py-1 rounded hidden sm:inline">{lanUrl}</code>
        {state.status === 'active' && (
          <GameTimer startedAt={state.startedAt ?? state.transactions?.[0]?.ts ?? Date.now()} />
        )}
        <ConnectionBadge connected={connected} />
        <LanguageSwitcher />
        <ThemeToggle />
        {state.status === 'active' && (
          <div className="dropdown dropdown-end">
            <label tabIndex={0} className="btn btn-ghost btn-circle" aria-label={t('common.menu')}>
              <MoreVertical size={20} />
            </label>
            <ul tabIndex={0} className="menu dropdown-content mt-3 z-[1] p-2 shadow-xl bg-base-200 rounded-box w-52">
              <li>
                <a onClick={onReset} className="text-error gap-2">
                  <RotateCcw size={16} /> {t('banker.resetGame')}
                </a>
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function SetupView({ socket, state, lanUrl }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PLAYER_COLORS[state.players.length % PLAYER_COLORS.length]);
  const [startingBalance, setStartingBalance] = useState(state.config.startingBalance);
  const [passGoBonus, setPassGoBonus] = useState(state.config.passGoBonus);
  const [quickAmounts, setQuickAmounts] = useState(getQuickAmounts(state));
  const [newQuick, setNewQuick] = useState('');

  const addQuickAmount = () => {
    const v = Math.floor(Number(newQuick));
    if (!Number.isFinite(v) || v <= 0) return toast.error(t('banker.addAmountError'));
    if (quickAmounts.includes(v)) return toast.error(t('banker.duplicateAmountError'));
    if (quickAmounts.length >= 12) return toast.error(t('banker.maxAmountsError'));
    setQuickAmounts([...quickAmounts, v].sort((a, b) => a - b));
    setNewQuick('');
  };

  const removeQuickAmount = (n) => {
    if (quickAmounts.length <= 1) return toast.error(t('banker.minAmountsError'));
    setQuickAmounts(quickAmounts.filter(x => x !== n));
  };

  const resetQuickAmounts = () => setQuickAmounts([...DEFAULT_QUICK_AMOUNTS]);

  const addPlayer = async () => {
    const trimmed = name.trim();
    if (!trimmed) return toast.error(t('banker.nameRequired'));
    try {
      await emit(socket, 'add-player', { name: trimmed, color });
      setName('');
      setColor(PLAYER_COLORS[(state.players.length + 1) % PLAYER_COLORS.length]);
    } catch (e) { toast.error(e.message); }
  };

  const removePlayer = async (id, playerName) => {
    if (!confirm(t('banker.removeGameConfirm', { name: playerName }))) return;
    try { await emit(socket, 'remove-player', { playerId: id }); }
    catch (e) { toast.error(e.message); }
  };

  const startGame = async () => {
    const sb = Number(startingBalance);
    const pg = Number(passGoBonus);
    if (!Number.isFinite(sb) || sb <= 0) return toast.error(t('banker.validBalanceError'));
    try { await emit(socket, 'start-game', { startingBalance: sb, passGoBonus: pg, quickAmounts }); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 space-y-4">
        <div className="card bg-base-200 shadow-md">
          <div className="card-body gap-6">
            <h2 className="card-title text-base gap-2"><Settings size={18} /> {t('banker.settings')}</h2>
            <label className="form-control">
              <div className="label py-1"><span className="label-text">{t('banker.startingBalance')}</span></div>
              <input type="number" className="input input-bordered" value={startingBalance}
                onChange={(e) => setStartingBalance(e.target.value)} min="1" />
            </label>
            <label className="form-control">
              <div className="label py-1"><span className="label-text">{t('banker.passGoBonus')}</span></div>
              <input type="number" className="input input-bordered" value={passGoBonus}
                onChange={(e) => setPassGoBonus(e.target.value)} min="0" />
            </label>

            <div className="form-control">
              <div className="label py-1">
                <span className="label-text">{t('banker.quickAmounts')}</span>
                <button type="button" className="label-text-alt link link-primary" onClick={resetQuickAmounts}>
                  {t('common.default')}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {quickAmounts.map(n => (
                  <div
                    key={n}
                    className="h-12 rounded-lg border border-base-content/20 bg-base-100/40 flex items-center justify-between px-3"
                  >
                    <span className="font-bold balance-display">+{n}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-circle text-error/70 hover:text-error"
                      onClick={() => removeQuickAmount(n)}
                      aria-label={t('banker.deleteAmountAria', { n })}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="join mt-3">
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder={t('banker.newAmount')}
                  className="input input-bordered join-item flex-1 min-w-0"
                  value={newQuick}
                  onChange={(e) => setNewQuick(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addQuickAmount())}
                  min="1"
                />
                <button
                  type="button"
                  className="btn btn-primary join-item gap-1"
                  onClick={addQuickAmount}
                >
                  <Plus size={16} /> {t('common.add')}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card bg-base-200 shadow-md">
          <div className="card-body">
            <h2 className="card-title text-base gap-2"><UserPlus size={18} /> {t('banker.addPlayer')}</h2>
            <input
              className="input input-bordered"
              placeholder={t('banker.playerName')}
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
            />
            <div className="flex gap-1 flex-wrap mt-2">
              {PLAYER_COLORS.map(c => (
                <button
                  key={c}
                  className={`w-9 h-9 rounded-full border-2 transition-transform hover:scale-110 ${color === c ? 'border-base-content scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                  aria-label={t('banker.colorAria', { color: c })}
                />
              ))}
            </div>
            <button className="btn btn-primary mt-2 gap-2" onClick={addPlayer}>
              <UserPlus size={18} /> {t('common.add')}
            </button>
          </div>
        </div>

        <button
          className="btn btn-success btn-lg w-full gap-2"
          disabled={state.players.length < 2}
          onClick={startGame}
        >
          <PlayCircle size={22} />
          {state.players.length < 2
            ? t('banker.startGameNeed', { count: state.players.length })
            : t('banker.startGame')}
        </button>
      </div>

      <div className="lg:col-span-2">
        <div className="card bg-base-200 shadow-md">
          <div className="card-body">
            <h2 className="card-title text-base gap-2"><Users size={18} /> {t('banker.playerCount', { count: state.players.length })}</h2>
            {state.players.length === 0 && (
              <div className="alert alert-info mt-2">
                <span>{t('banker.noPlayersYet')}</span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              {state.players.map(p => (
                <PlayerJoinCard key={p.id} player={p} lanUrl={lanUrl} onRemove={() => removePlayer(p.id, p.name)} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerJoinCard({ player, lanUrl, onRemove }) {
  const { t } = useTranslation();
  const link = `${lanUrl}/join/${player.token}`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const ok = await copyText(link);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error(t('banker.copyFailed'));
    }
  };

  return (
    <div
      className="card bg-base-100 shadow-sm overflow-hidden border-2"
      style={{ borderColor: player.color }}
    >
      <div
        className="px-3 py-2 flex items-center justify-between text-white"
        style={{ backgroundColor: player.color }}
      >
        <span className="font-bold text-sm drop-shadow-sm">{player.name}</span>
        <button
          className="btn btn-ghost btn-xs btn-circle text-white hover:bg-white/20"
          onClick={onRemove}
          aria-label={t('common.remove')}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="card-body p-3 items-center">
        <div className="bg-white p-2 rounded-lg">
          <QrCode value={link} size={200} />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
          <button className="btn btn-xs btn-ghost gap-1" onClick={copy}>
            {copied ? <><Check size={12} /> {t('common.copied')}</> : <><Copy size={12} /> {t('banker.copyLink')}</>}
          </button>
          <a className="btn btn-xs btn-primary gap-1" href={link} target="_blank" rel="noreferrer">
            <ExternalLink size={12} /> Oyuncu ekranını aç
          </a>
        </div>
      </div>
    </div>
  );
}

function ActiveView({ socket, state, lanUrl }) {
  const [qrPlayer, setQrPlayer] = useState(null);
  return (
    <>
      <ConfigBar socket={socket} state={state} />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mt-4">
        <div className="lg:col-span-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {state.players.map(p => (
              <BankerPlayerCard
                key={p.id}
                socket={socket}
                player={p}
                state={state}
                onShowQr={() => setQrPlayer(p)}
              />
            ))}
          </div>
        </div>
        <div className="lg:col-span-2">
          <HistoryCard socket={socket} state={state} />
        </div>
      </div>
      {qrPlayer && (
        <QrModal player={qrPlayer} lanUrl={lanUrl} onClose={() => setQrPlayer(null)} />
      )}
    </>
  );
}

function QrModal({ player, lanUrl, onClose }) {
  const { t } = useTranslation();
  const link = `${lanUrl}/join/${player.token}`;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    const ok = await copyText(link);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error(t('banker.copyFailed'));
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="card bg-base-100 shadow-2xl max-w-sm w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="card-body items-center text-center">
          <div className="badge badge-lg text-white font-bold text-base px-4 py-3" style={{ backgroundColor: player.color }}>
            {player.name}
          </div>
          <p className="text-sm opacity-70 mt-1">{t('banker.qrModalHint')}</p>
          <div className="bg-white p-3 rounded-xl my-2">
            <QrCode value={link} size={240} />
          </div>
          <code className="text-xs opacity-60 break-all bg-base-200 px-2 py-1 rounded w-full">{link}</code>
          <div className="flex gap-2 w-full mt-2">
            <button className="btn btn-outline flex-1 gap-1" onClick={copy}>
              {copied ? <><Check size={16} /> {t('common.copied')}</> : <><Copy size={16} /> {t('common.copy')}</>}
            </button>
            <button className="btn btn-primary flex-1" onClick={onClose}>{t('common.close')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigBar({ socket, state }) {
  const { t } = useTranslation();
  const [bonus, setBonus] = useState(state.config.passGoBonus);
  const [editing, setEditing] = useState(false);

  const save = async () => {
    const v = Number(bonus);
    if (!Number.isFinite(v) || v < 0) return toast.error(t('player.sendModal.invalidAmount'));
    try {
      await emit(socket, 'update-config', { passGoBonus: v });
      toast.success(t('banker.passGoUpdated'));
      setEditing(false);
    } catch (e) { toast.error(e.message); }
  };

  const totalMoney = state.players.reduce((sum, p) => sum + p.balance, 0);
  const onlineCount = state.players.filter(p => p.online).length;

  return (
    <div className="card bg-base-200 shadow-md">
      <div className="card-body p-3">
        <div className="flex items-center gap-4 flex-wrap text-sm">
          <Stat label={t('banker.playerStat')} value={`${onlineCount}/${state.players.length}`} icon={<Users size={20} />} />
          <Stat label={t('banker.totalMoneyStat')} value={fmt(totalMoney, state.config.currency)} icon={<Wallet size={20} />} />
          <Stat label={t('banker.transactionStat')} value={state.transactions.filter(tx => !tx.undone).length} icon={<ListChecks size={20} />} />
          <div className="flex items-center gap-2 ml-auto">
            <span className="opacity-70 text-xs">{t('banker.passGoBonus')}:</span>
            {editing ? (
              <>
                <input
                  type="number"
                  className="input input-bordered input-sm w-24"
                  value={bonus}
                  onChange={(e) => setBonus(e.target.value)}
                  min="0"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' ? save() : e.key === 'Escape' ? setEditing(false) : null}
                />
                <button className="btn btn-sm btn-primary" onClick={save}>✓</button>
                <button className="btn btn-sm btn-ghost" onClick={() => { setBonus(state.config.passGoBonus); setEditing(false); }}>✕</button>
              </>
            ) : (
              <>
                <span className="font-bold balance-display">{fmt(state.config.passGoBonus, state.config.currency)}</span>
                <button className="btn btn-xs btn-ghost" onClick={() => setEditing(true)}>✎</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon }) {
  return (
    <div className="flex items-center gap-2">
      <span className="opacity-70">{icon}</span>
      <div>
        <div className="text-xs opacity-60 leading-tight">{label}</div>
        <div className="font-bold balance-display leading-tight">{value}</div>
      </div>
    </div>
  );
}

function BankerPlayerCard({ socket, player, state, onShowQr }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const cur = state.config.currency;
  const numAmount = Number(amount) || 0;
  const quickAmounts = getQuickAmounts(state);

  const adjust = async (sign) => {
    if (!Number.isFinite(numAmount) || numAmount <= 0) return toast.error(t('banker.amountPositiveError'));
    try {
      await emit(socket, 'banker-adjust', { playerId: player.id, amount: sign * numAmount });
      setAmount('');
      toast.success(sign > 0
        ? t('banker.give', { amount: '+' + fmt(numAmount, cur) })
        : t('banker.take', { amount: '−' + fmt(numAmount, cur) }));
    } catch (e) { toast.error(e.message); }
  };

  const addQuick = (n) => setAmount(String(numAmount + n));

  const passGo = async () => {
    try {
      await emit(socket, 'pass-go', { playerId: player.id });
      toast.success(t('banker.passGoGiven', { amount: '+' + fmt(state.config.passGoBonus, cur) }));
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div
      data-testid="player-card"
      className="card bg-base-200 shadow-md hover:shadow-xl transition-all overflow-hidden border-2"
      style={{ borderColor: player.color }}
    >
      <div
        className="px-4 py-2 flex items-center justify-between text-white"
        style={{ backgroundColor: player.color }}
      >
        <span className="font-black text-base tracking-wide drop-shadow-sm">{player.name}</span>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium opacity-90">
            {player.online ? `● ${t('common.online')}` : `○ ${t('common.offline')}`}
          </span>
          <button
            className="btn btn-ghost btn-xs btn-circle text-white hover:bg-white/20"
            onClick={onShowQr}
            title={t('banker.showQrAria')}
            aria-label={t('banker.showQrAria')}
          >
            <QrIcon size={16} />
          </button>
        </div>
      </div>
      <div className="card-body p-4 gap-5">
        <div data-testid="balance" className="balance-display text-center text-3xl xl:text-4xl font-black">
          {fmt(player.balance, cur)}
        </div>
        <div className="join w-full">
          <input
            type="number"
            inputMode="numeric"
            placeholder={t('common.amount')}
            className="input input-bordered join-item flex-1 min-w-0 h-10 min-h-0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="1"
            onKeyDown={(e) => e.key === 'Enter' && adjust(1)}
          />
          <button className="btn btn-success join-item gap-1 h-10 min-h-0" onClick={() => adjust(1)} title={t('banker.giveMoney')}>
            <Plus size={16} /> {t('banker.giveMoney')}
          </button>
          <button className="btn btn-error join-item gap-1 h-10 min-h-0" onClick={() => adjust(-1)} title={t('banker.takeMoney')}>
            <Minus size={16} /> {t('banker.takeMoney')}
          </button>
        </div>
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${Math.min(quickAmounts.length, 6)}, minmax(0, 1fr))` }}
        >
          {quickAmounts.map(n => (
            <button
              key={n}
              type="button"
              className="btn btn-sm btn-outline h-10"
              onClick={() => addQuick(n)}
            >
              +{n}
            </button>
          ))}
        </div>
        <button className="btn btn-outline btn-warning btn-block btn-sm h-10 min-h-0 gap-2" onClick={passGo}>
          <Dices size={18} /> {t('banker.goBonusButton', { amount: fmt(state.config.passGoBonus, cur) })}
        </button>
      </div>
    </div>
  );
}

function HistoryCard({ socket, state }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('tx');
  const [, force] = useState(0);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const undo = async (id) => {
    try { await emit(socket, 'undo', { transactionId: id }); toast.success(t('history.undone')); }
    catch (e) { toast.error(e.message); }
  };

  const allTxs = [...state.transactions].reverse();
  const txs = allTxs.filter(tx => matchFilter(tx, filter));
  const diceCount = state.diceRolls?.length ?? 0;

  // İşlem bloğu (filtre + liste); kaydırma yüksekliği sekmeye göre değişir
  const renderTxs = (heightClass) => (
    <>
      <FilterBar state={state} filter={filter} setFilter={setFilter} />
      {allTxs.length === 0 ? (
        <div className="text-center py-8 opacity-50 text-base">
          <div className="text-3xl mb-2">📭</div>
          {t('history.noTransactions')}
        </div>
      ) : txs.length === 0 ? (
        <div className="text-center py-8 opacity-50 text-base">
          <div className="text-3xl mb-2">🔍</div>
          {t('history.noFilteredTransactions')}
        </div>
      ) : (
        <div className={`overflow-y-auto ${heightClass} -mx-2 px-2`}>
          {txs.map(tx => (
            <TxRow key={tx.id} tx={tx} state={state} onUndo={undo} />
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="card bg-base-200 shadow-md mb-4">
      <div className="card-body p-4">
        <div role="tablist" className="tabs tabs-boxed tabs-lg bg-base-300">
          <button
            type="button"
            role="tab"
            className={`tab gap-2 flex-1 ${tab === 'tx' ? 'tab-active' : ''}`}
            onClick={() => setTab('tx')}
          >
            <Receipt size={22} /> {t('history.transactions')}
            <span className="badge badge-ghost badge-sm">{allTxs.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            className={`tab gap-2 flex-1 ${tab === 'dice' ? 'tab-active' : ''}`}
            onClick={() => setTab('dice')}
          >
            <Dices size={22} /> {t('history.dice')}
            <span className="badge badge-ghost badge-sm">{diceCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            className={`tab gap-2 flex-1 ${tab === 'both' ? 'tab-active' : ''}`}
            onClick={() => setTab('both')}
          >
            <Rows2 size={22} /> {t('history.both')}
          </button>
        </div>

        {tab === 'tx' && renderTxs('max-h-[calc(100vh-23rem)]')}
        {tab === 'dice' && <DiceList state={state} large maxHeightClass="max-h-[calc(100vh-20rem)]" />}
        {tab === 'both' && (
          <>
            <h3 className="flex items-center gap-2 text-lg font-bold mt-3">
              <Receipt size={22} /> {t('history.transactions')}
            </h3>
            {renderTxs('max-h-[max(12rem,calc((100vh-30rem)/2))]')}
            <h3 className="flex items-center gap-2 text-lg font-bold mt-3">
              <Dices size={22} /> {t('history.dice')}
            </h3>
            <DiceList state={state} large maxHeightClass="max-h-[max(12rem,calc((100vh-30rem)/2))]" />
          </>
        )}
      </div>
    </div>
  );
}

function FilterBar({ state, filter, setFilter }) {
  const { t } = useTranslation();
  const FilterChip = ({ value, label, color, active }) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      className={`px-3 py-1.5 rounded-full text-sm font-bold border-2 transition-all whitespace-nowrap ${active ? 'shadow-sm scale-105' : 'opacity-60 hover:opacity-100'}`}
      style={{
        borderColor: color,
        backgroundColor: active ? color : 'transparent',
        color: active ? 'white' : color,
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="flex gap-1.5 flex-wrap mt-1 mb-2">
      <button
        type="button"
        onClick={() => setFilter('all')}
        className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
      >
        {t('common.all')}
      </button>
      <FilterChip
        value="bank"
        label={`🏦 ${t('common.bank')}`}
        color="#64748b"
        active={filter === 'bank'}
      />
      {state.players.map(p => (
        <FilterChip
          key={p.id}
          value={`player:${p.id}`}
          label={p.name}
          color={p.color}
          active={filter === `player:${p.id}`}
        />
      ))}
    </div>
  );
}

function TxRow({ tx, state, onUndo }) {
  const { t } = useTranslation();
  const cur = state.config.currency;
  const fromP = state.players.find(p => p.id === tx.from);
  const toP = state.players.find(p => p.id === tx.to);
  const meta = TX_META[tx.type] ?? { Icon: ArrowLeftRight, color: 'opacity-60' };
  const Icon = meta.Icon;

  return (
    <div className={`group rounded-lg p-3 hover:bg-base-300/50 transition-colors ${tx.undone ? 'opacity-40' : ''}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 ${meta.color}`}>
          <Icon size={26} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-lg">
            {fromP ? <Chip player={fromP} /> : <span className="opacity-60 text-lg">{t('common.bank')}</span>}
            <span className="opacity-50">→</span>
            {toP ? <Chip player={toP} /> : <span className="opacity-60 text-lg">{t('common.bank')}</span>}
          </div>
          <div className="flex items-baseline justify-between gap-2 mt-1">
            <span className={`text-3xl font-black balance-display ${tx.undone ? 'line-through' : ''}`}>
              {fmt(tx.amount, cur)}
            </span>
            <span className="text-base opacity-50">{formatRelative(tx.ts)}</span>
          </div>
        </div>
        {!tx.undone && (
          <button
            className="btn btn-ghost btn-sm btn-circle opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onUndo(tx.id)}
            title={t('history.undoAria')}
            aria-label={t('history.undoAria')}
          >
            <Undo2 size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({ player }) {
  return (
    <span
      className="text-lg font-bold px-2 py-0.5 rounded text-white"
      style={{ backgroundColor: player.color }}
    >
      {player.name}
    </span>
  );
}

const TX_META = {
  'transfer':       { Icon: ArrowLeftRight,    color: 'text-info' },
  'pass-go':        { Icon: Dices,             color: 'text-success' },
  'banker-credit':  { Icon: ArrowDownToLine,   color: 'text-success' },
  'banker-debit':   { Icon: ArrowUpFromLine,   color: 'text-error' },
  'initial':        { Icon: Flag,              color: 'text-warning' },
};

createRoot(document.getElementById('root')).render(<App />);
