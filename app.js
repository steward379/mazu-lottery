/* ===========================
   拉霸抽獎機 App Logic
   三滾輪湊三個相同符號 → 顯示得獎者
   =========================== */

(function () {
  'use strict';

  // 拉霸機符號（呼應台灣廟宇 × 可愛元素）
  const SYMBOLS = ['🐯', '🪷', '⭐', '🍊', '🧋', '☁️', '🎋', '🎐'];

  // ---------- 狀態 ----------
  const state = {
    participants: [],
    prizes: [],
    winners: [],
    drawnNames: new Set(),
    isDrawing: false,
  };

  let prizeIdCounter = 0;

  // ---------- DOM 引用 ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    participants: $('participants'),
    participantCount: $('participant-count'),
    clearParticipants: $('clear-participants'),
    prizesList: $('prizes-list'),
    addPrize: $('add-prize'),
    startDraw: $('start-draw'),
    resetAll: $('reset-all'),
    currentPrize: $('current-prize'),
    resultDisplay: $('result-display'),
    resultName: $('result-name'),
    lever: $('lever'),
    winnersList: $('winners-list'),
    copyWinners: $('copy-winners'),
    celebration: $('celebration'),
    toast: $('toast'),
    reelsFrame: $('reels-frame'),
    payline: $('payline'),
    reels: [$('reel-1'), $('reel-2'), $('reel-3')],
    windows: [$('window-1'), $('window-2'), $('window-3')],
  };

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2400);
  }

  // ---------- 參加者 ----------
  function parseParticipants() {
    const raw = el.participants.value;
    state.participants = [
      ...new Set(
        raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
      ),
    ];
    el.participantCount.textContent = state.participants.length;
    updateStartButton();
  }

  el.participants.addEventListener('input', parseParticipants);

  el.clearParticipants.addEventListener('click', () => {
    if (!el.participants.value.trim()) return;
    if (confirm('確定要清空名單嗎？')) {
      el.participants.value = '';
      parseParticipants();
    }
  });

  // ---------- 獎項 ----------
  function createPrizeRow(initialName = '', initialCount = 1) {
    const id = ++prizeIdCounter;
    const row = document.createElement('div');
    row.className = 'prize-item';
    row.dataset.id = id;
    row.innerHTML = `
      <input type="text" class="prize-name" placeholder="獎項名稱" value="${escapeHtml(initialName)}" />
      <input type="number" class="prize-count" min="1" value="${initialCount}" />
      <button type="button" class="remove-prize" aria-label="移除獎項">×</button>
    `;
    el.prizesList.appendChild(row);

    row.querySelector('.prize-name').addEventListener('input', syncPrizes);
    row.querySelector('.prize-count').addEventListener('input', syncPrizes);
    row.querySelector('.remove-prize').addEventListener('click', () => {
      row.remove();
      syncPrizes();
    });

    syncPrizes();
  }

  function syncPrizes() {
    const rows = [...el.prizesList.querySelectorAll('.prize-item')];
    state.prizes = rows.map((row) => ({
      id: row.dataset.id,
      name: row.querySelector('.prize-name').value.trim(),
      count: Math.max(1, parseInt(row.querySelector('.prize-count').value, 10) || 1),
    }));
    updateStartButton();
  }

  el.addPrize.addEventListener('click', () => createPrizeRow());

  // 初始獎項
  createPrizeRow('頭獎', 1);

  // ---------- 按鈕狀態 ----------
  function updateStartButton() {
    const hasParticipants = state.participants.length > 0;
    const hasPrizes = state.prizes.length > 0 && state.prizes.every((p) => p.name);
    const totalNeeded = state.prizes.reduce((sum, p) => sum + p.count, 0);
    const available = state.participants.length - state.drawnNames.size;

    const canStart =
      hasParticipants &&
      hasPrizes &&
      available >= totalNeeded &&
      !state.isDrawing;

    el.startDraw.disabled = !canStart;
    el.lever.disabled = !canStart;

    if (hasParticipants && hasPrizes && available < totalNeeded) {
      el.startDraw.title = `參加人數不足（需 ${totalNeeded} 人，剩 ${available} 人）`;
    } else {
      el.startDraw.title = '';
    }
  }

  // ---------- 抽獎流程 ----------
  el.startDraw.addEventListener('click', pullLever);
  el.lever.addEventListener('click', pullLever);

  async function pullLever() {
    if (state.isDrawing || el.startDraw.disabled) return;
    // 拉桿動畫
    el.lever.classList.add('pulling');
    setTimeout(() => el.lever.classList.remove('pulling'), 500);

    startDrawSequence();
  }

  async function startDrawSequence() {
    if (state.isDrawing) return;
    state.isDrawing = true;
    updateStartButton();

    for (const prize of state.prizes) {
      await drawPrize(prize);
    }

    state.isDrawing = false;
    el.currentPrize.textContent = '抽獎完成 🎉';
    el.currentPrize.classList.remove('active');
    updateStartButton();
    showToast('全部獎項已抽出完畢');
  }

  async function drawPrize(prize) {
    el.currentPrize.textContent = `正在抽：${prize.name}（${prize.count} 位）`;
    el.currentPrize.classList.add('active');

    const prizeWinners = [];

    for (let i = 0; i < prize.count; i++) {
      const pool = state.participants.filter((n) => !state.drawnNames.has(n));
      if (pool.length === 0) break;

      const winner = pool[Math.floor(Math.random() * pool.length)];
      await spinReels(winner);
      state.drawnNames.add(winner);
      prizeWinners.push(winner);

      await sleep(1200);
    }

    state.winners.push({ prizeName: prize.name, names: prizeWinners });
    renderWinners();
  }

  // ---------- 滾輪動畫（符號版）----------
  async function spinReels(winnerName) {
    // 先重置狀態
    el.resultName.textContent = '— — —';
    el.resultName.classList.remove('win');
    el.resultDisplay.classList.remove('win');
    el.reelsFrame.classList.remove('jackpot');
    el.payline.classList.remove('active');
    el.windows.forEach((w) => w.classList.remove('win'));

    // 決定這次要湊齊的符號（隨機挑一個）
    const targetSymbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

    // 三個滾輪開始轉
    el.reels.forEach((reel) => reel.classList.add('spinning'));

    // 轉動中不斷換符號（視覺效果）
    const interval = setInterval(() => {
      el.reels.forEach((reel) => {
        const track = reel.querySelector('.reel-track');
        const randomSym = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
        track.innerHTML = `<div class="reel-item">${randomSym}</div>`;
      });
    }, 80);

    // 依序停下三個滾輪，都定格在同一個符號
    await sleep(1000);
    stopReel(0, targetSymbol);

    await sleep(600);
    stopReel(1, targetSymbol);

    await sleep(600);
    stopReel(2, targetSymbol);

    clearInterval(interval);

    // 中獎效果：滾輪發光、流光、payline 亮起
    await sleep(200);
    el.windows.forEach((w, i) => {
      setTimeout(() => w.classList.add('win'), i * 100);
    });
    el.payline.classList.add('active');
    el.reelsFrame.classList.add('jackpot');

    // 再停一下，讓玩家看到三個符號
    await sleep(700);

    // 顯示得獎者名字
    el.resultDisplay.classList.add('win');
    el.resultName.textContent = winnerName;
    el.resultName.classList.add('win');
    playCelebration();
  }

  function stopReel(index, symbol) {
    const reel = el.reels[index];
    reel.classList.remove('spinning');
    const track = reel.querySelector('.reel-track');
    track.innerHTML = `<div class="reel-item">${symbol}</div>`;
  }

  // ---------- 紙花特效 ----------
  function playCelebration() {
    const colors = ['#fcd34d', '#f08149', '#ff8b5a', '#c94a3a', '#7cb87a', '#fff4d1'];
    const count = 50;

    for (let i = 0; i < count; i++) {
      const confetti = document.createElement('div');
      confetti.className = 'confetti';
      confetti.style.left = Math.random() * 100 + '%';
      confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      confetti.style.animationDuration = (1.8 + Math.random() * 1.5) + 's';
      confetti.style.animationDelay = Math.random() * 0.4 + 's';
      confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
      el.celebration.appendChild(confetti);

      setTimeout(() => confetti.remove(), 3800);
    }
  }

  // ---------- 中獎名單 ----------
  function renderWinners() {
    if (state.winners.length === 0) {
      el.winnersList.innerHTML = '<div class="empty-state">尚未開獎</div>';
      el.copyWinners.disabled = true;
      return;
    }

    el.winnersList.innerHTML = state.winners
      .map(
        (w) => `
        <div class="winner-group">
          <div class="winner-prize-title">${escapeHtml(w.prizeName)}</div>
          <div class="winner-names">
            ${w.names.map((n) => `<span class="name-tag">${escapeHtml(n)}</span>`).join('')}
          </div>
        </div>
      `
      )
      .join('');

    el.copyWinners.disabled = false;
  }

  el.copyWinners.addEventListener('click', () => {
    const text = state.winners
      .map((w) => `【${w.prizeName}】\n${w.names.join('、')}`)
      .join('\n\n');
    navigator.clipboard.writeText(text).then(
      () => showToast('已複製中獎名單到剪貼簿'),
      () => showToast('複製失敗，請手動選取')
    );
  });

  // ---------- 重置 ----------
  el.resetAll.addEventListener('click', () => {
    if (state.isDrawing) {
      showToast('抽獎進行中，請稍候');
      return;
    }
    if (!confirm('確定要重置全部嗎？（清空名單、獎項、中獎紀錄）')) return;

    el.participants.value = '';
    state.participants = [];
    state.winners = [];
    state.drawnNames.clear();
    el.prizesList.innerHTML = '';
    prizeIdCounter = 0;
    createPrizeRow('頭獎', 1);

    parseParticipants();
    renderWinners();

    el.currentPrize.textContent = '請設定獎項並拉下拉桿';
    el.currentPrize.classList.remove('active');
    el.resultName.textContent = '— — —';
    el.resultName.classList.remove('win');
    el.resultDisplay.classList.remove('win');
    el.reelsFrame.classList.remove('jackpot');
    el.payline.classList.remove('active');
    el.windows.forEach((w) => w.classList.remove('win'));
    el.reels.forEach((r) => {
      r.querySelector('.reel-track').innerHTML = '<div class="reel-item">❓</div>';
    });

    showToast('已重置');
  });

  // ---------- 工具 ----------
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------- 初始化 ----------
  parseParticipants();
  renderWinners();
})();
