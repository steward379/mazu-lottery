/* ===========================
   拉霸抽獎機 App Logic
   =========================== */

(function () {
  'use strict';

  // ---------- 狀態 ----------
  const state = {
    participants: [],     // 全部參加者
    prizes: [],            // 獎項 [{id, name, count}]
    winners: [],           // 中獎紀錄 [{prizeName, names: []}]
    drawnNames: new Set(), // 已中獎的人（不重複）
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
    resultName: $('result-name'),
    lever: $('lever'),
    winnersList: $('winners-list'),
    copyWinners: $('copy-winners'),
    celebration: $('celebration'),
    toast: $('toast'),
    reels: [$('reel-1'), $('reel-2'), $('reel-3')],
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
    state.participants = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    // 去重
    state.participants = [...new Set(state.participants)];
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
      <input type="text" class="prize-name" placeholder="獎項名稱（如：頭獎 iPhone）" value="${escapeHtml(initialName)}" />
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

  // 初始化一個預設獎項
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

    if (hasParticipants && hasPrizes && available < totalNeeded) {
      el.startDraw.title = `參加人數不足（需要 ${totalNeeded} 人，剩餘 ${available} 人）`;
    } else {
      el.startDraw.title = '';
    }
  }

  // ---------- 抽獎流程 ----------
  el.startDraw.addEventListener('click', startDrawSequence);
  el.lever.addEventListener('click', () => {
    if (!el.startDraw.disabled) startDrawSequence();
  });

  async function startDrawSequence() {
    if (state.isDrawing) return;
    state.isDrawing = true;
    updateStartButton();

    // 依序抽每個獎項
    for (const prize of state.prizes) {
      await drawPrize(prize);
    }

    state.isDrawing = false;
    el.currentPrize.textContent = '抽獎完成！';
    el.currentPrize.classList.remove('active');
    updateStartButton();
    showToast('🎉 全部獎項抽出完畢');
  }

  async function drawPrize(prize) {
    el.currentPrize.textContent = `正在抽：${prize.name}（${prize.count} 位）`;
    el.currentPrize.classList.add('active');

    const prizeWinners = [];

    for (let i = 0; i < prize.count; i++) {
      // 可用人選 = 全部 - 已中獎
      const pool = state.participants.filter((name) => !state.drawnNames.has(name));
      if (pool.length === 0) break;

      const winner = pool[Math.floor(Math.random() * pool.length)];
      await spinReels(winner);
      state.drawnNames.add(winner);
      prizeWinners.push(winner);

      // 小停頓後進下一位
      await sleep(800);
    }

    // 記錄到中獎名單
    state.winners.push({ prizeName: prize.name, names: prizeWinners });
    renderWinners();
  }

  // ---------- 滾輪動畫 ----------
  function splitName(name) {
    // 把名字切成三段顯示在三個滾輪上
    // 規則：2 字 → [字1, ·, 字2]；3 字 → [字1, 字2, 字3]
    // 4 字以上 → 平均分三段；1 字 → [·, 字1, ·]
    const chars = [...name];
    if (chars.length === 1) return ['★', chars[0], '★'];
    if (chars.length === 2) return [chars[0], '♦', chars[1]];
    if (chars.length === 3) return chars;
    // 4+ 字：盡量平均分三塊
    const len = chars.length;
    const a = Math.ceil(len / 3);
    const b = Math.ceil((len - a) / 2);
    return [
      chars.slice(0, a).join(''),
      chars.slice(a, a + b).join(''),
      chars.slice(a + b).join(''),
    ];
  }

  function randomChar() {
    const pool = state.participants;
    if (pool.length === 0) return '？';
    const randomName = pool[Math.floor(Math.random() * pool.length)];
    const chars = [...randomName];
    return chars[Math.floor(Math.random() * chars.length)];
  }

  async function spinReels(winnerName) {
    el.resultName.textContent = '— — —';
    el.resultName.classList.remove('win');

    const parts = splitName(winnerName);

    // 三個滾輪都開始轉
    el.reels.forEach((reel) => reel.classList.add('spinning'));

    // 在轉動過程中不斷更新內容（視覺上就是在滾）
    const interval = setInterval(() => {
      el.reels.forEach((reel) => {
        const track = reel.querySelector('.reel-track');
        track.innerHTML = `<div class="reel-item">${escapeHtml(randomChar())}</div>`;
      });
    }, 80);

    // 依序停下三個滾輪
    await sleep(1200);
    stopReel(0, parts[0]);

    await sleep(700);
    stopReel(1, parts[1]);

    await sleep(700);
    stopReel(2, parts[2]);

    clearInterval(interval);

    // 展示得獎者
    await sleep(400);
    el.resultName.textContent = winnerName;
    el.resultName.classList.add('win');
    playCelebration();
  }

  function stopReel(index, finalChar) {
    const reel = el.reels[index];
    reel.classList.remove('spinning');
    const track = reel.querySelector('.reel-track');
    track.innerHTML = `<div class="reel-item">${escapeHtml(finalChar)}</div>`;
  }

  // ---------- 紙花特效 ----------
  function playCelebration() {
    const colors = ['#d4a24c', '#f4cc6a', '#c1272d', '#e63946', '#f4e8d0'];
    const count = 40;

    for (let i = 0; i < count; i++) {
      const confetti = document.createElement('div');
      confetti.className = 'confetti';
      confetti.style.left = Math.random() * 100 + '%';
      confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      confetti.style.animationDuration = (1.5 + Math.random() * 1.5) + 's';
      confetti.style.animationDelay = Math.random() * 0.3 + 's';
      confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
      el.celebration.appendChild(confetti);

      setTimeout(() => confetti.remove(), 3500);
    }
  }

  // ---------- 中獎名單渲染 ----------
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

    el.currentPrize.textContent = '請設定獎項並開始抽獎';
    el.currentPrize.classList.remove('active');
    el.resultName.textContent = '— — —';
    el.resultName.classList.remove('win');
    el.reels.forEach((r) => {
      r.querySelector('.reel-track').innerHTML = '<div class="reel-item">？</div>';
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
