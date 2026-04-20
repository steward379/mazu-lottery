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
    // Tab & 轉盤
    modeTabs: document.querySelectorAll('.mode-tab'),
    modePanels: document.querySelectorAll('.mode-panel'),
    removeAfterWin: $('remove-after-win'),
    wheelSvg: $('wheel-svg'),
    wheelHub: $('wheel-hub'),
    wheelPointer: document.querySelector('.wheel-pointer'),
    wheelWrap: document.querySelector('.wheel-wrap'),
    wheelCurrentPrize: $('wheel-current-prize'),
    wheelResultDisplay: $('wheel-result-display'),
    wheelResultName: $('wheel-result-name'),
  };

  // ---------- 目前模式 ----------
  let currentMode = 'slot'; // 'slot' | 'wheel'
  // 轉盤狀態
  let wheelRotation = 0; // 累積角度
  let wheelAvailable = []; // 轉盤上目前仍可抽的名字
  let wheelSpinning = false;
  /** 轉盤模式：各獎項已抽出幾位（與拉霸共用 state.winners / drawnNames 分開追蹤） */
  const wheelPrizeProgress = new Map();

  // ---------- Toast ----------
  let toastTimer = null;
  let toastAfterHideTimer = null;
  function showToast(msg) {
    const text = String(msg ?? '').trim();
    clearTimeout(toastTimer);
    clearTimeout(toastAfterHideTimer);
    if (!text) {
      el.toast.classList.remove('show');
      el.toast.textContent = '';
      el.toast.setAttribute('aria-hidden', 'true');
      return;
    }
    el.toast.textContent = text;
    el.toast.setAttribute('aria-hidden', 'false');
    el.toast.classList.add('show');
    toastTimer = setTimeout(() => {
      el.toast.classList.remove('show');
      // 等滑出動畫結束再清空，避免空白膠囊仍佔版面或被讀出
      toastAfterHideTimer = setTimeout(() => {
        el.toast.textContent = '';
        el.toast.setAttribute('aria-hidden', 'true');
      }, 350);
    }, 2400);
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
    // 同步更新轉盤候選（尚未中獎者）
    refreshWheelAvailable();
    updateStartButton();
  }

  function refreshWheelAvailable() {
    wheelAvailable = state.participants.filter((n) => !state.drawnNames.has(n));
    drawWheel();
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

    let canStart;
    if (currentMode === 'wheel') {
      // 轉盤：一次抽一位，轉盤上還有人、獎項還沒抽完即可
      const nextPrize = getCurrentWheelPrize();
      canStart =
        hasParticipants &&
        hasPrizes &&
        wheelAvailable.length > 0 &&
        nextPrize !== null &&
        !wheelSpinning &&
        !state.isDrawing;
    } else {
      // 拉霸：一次跑完所有獎項，需要人數 ≥ 總中獎人數
      canStart =
        hasParticipants &&
        hasPrizes &&
        available >= totalNeeded &&
        !state.isDrawing;
    }

    el.startDraw.disabled = !canStart;
    el.lever.disabled = !canStart;

    if (
      currentMode === 'slot' &&
      hasParticipants &&
      hasPrizes &&
      available < totalNeeded &&
      !(state.winners.length === state.prizes.length && state.prizes.length > 0 && !state.isDrawing)
    ) {
      el.startDraw.title = `參加人數不足（需 ${totalNeeded} 人，剩 ${available} 人）`;
    } else if (
      currentMode === 'slot' &&
      hasParticipants &&
      hasPrizes &&
      !state.isDrawing &&
      state.winners.length === state.prizes.length &&
      state.prizes.length > 0
    ) {
      el.startDraw.title = '本局已抽完，請切換「轉盤 / 拉霸」分頁或按重置後再抽';
    } else if (
      currentMode === 'wheel' &&
      hasParticipants &&
      hasPrizes &&
      !wheelSpinning &&
      getCurrentWheelPrize() === null
    ) {
      el.startDraw.title = '本局獎項已抽完，請切換分頁或按重置後再抽';
    } else {
      el.startDraw.title = '';
    }
  }

  // ---------- 抽獎流程 ----------
  el.startDraw.addEventListener('click', () => {
    if (currentMode === 'wheel') {
      spinWheel();
    } else {
      pullLever();
    }
  });
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

    // 重置轉盤
    wheelRotation = 0;
    if (el.wheelSvg) {
      el.wheelSvg.style.transition = 'none';
      el.wheelSvg.style.transform = 'rotate(0deg)';
    }
    if (el.wheelCurrentPrize) {
      el.wheelCurrentPrize.textContent = '請設定獎項並點擊轉盤';
      el.wheelCurrentPrize.classList.remove('active');
    }
    if (el.wheelResultName) {
      el.wheelResultName.textContent = '— — —';
      el.wheelResultName.classList.remove('win');
    }
    if (el.wheelResultDisplay) {
      el.wheelResultDisplay.classList.remove('win');
    }

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

  // ===========================================================
  //                     Tab 切換
  // ===========================================================
  /** 切換遊戲模式時清空本局進度（保留名單與獎項設定），避免 drawnNames / 轉盤進度殘留導致按鈕永遠無法抽 */
  function resetDrawSessionPreserveForm() {
    state.drawnNames.clear();
    wheelPrizeProgress.clear();
    state.winners = [];
    state.isDrawing = false;
    wheelSpinning = false;
    wheelRotation = 0;
    if (el.wheelSvg) {
      el.wheelSvg.style.transition = 'none';
      el.wheelSvg.style.transform = 'rotate(0deg)';
    }
    el.currentPrize.textContent = '請設定獎項並拉下拉桿';
    el.currentPrize.classList.remove('active');
    el.resultName.textContent = '— — —';
    el.resultName.classList.remove('win');
    el.resultDisplay.classList.remove('win');
    el.reelsFrame.classList.remove('jackpot');
    el.payline.classList.remove('active');
    el.windows.forEach((w) => w.classList.remove('win'));
    el.reels.forEach((r) => {
      const track = r.querySelector('.reel-track');
      if (track) track.innerHTML = '<div class="reel-item">❓</div>';
    });
    if (el.wheelCurrentPrize) {
      el.wheelCurrentPrize.textContent = '請設定獎項並點擊轉盤';
      el.wheelCurrentPrize.classList.remove('active');
    }
    if (el.wheelResultName) {
      el.wheelResultName.textContent = '— — —';
      el.wheelResultName.classList.remove('win');
    }
    if (el.wheelResultDisplay) {
      el.wheelResultDisplay.classList.remove('win');
    }
    el.wheelWrap?.classList.remove('spinning');
    if (el.wheelHub) el.wheelHub.disabled = false;
    refreshWheelAvailable();
    drawWheel();
    renderWinners();
    updateStartButton();
  }

  el.modeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode;
      if (mode === currentMode || state.isDrawing || wheelSpinning) return;
      switchMode(mode);
    });
  });

  function switchMode(mode) {
    resetDrawSessionPreserveForm();
    currentMode = mode;
    el.modeTabs.forEach((t) => {
      t.classList.toggle('active', t.dataset.mode === mode);
    });
    el.modePanels.forEach((p) => {
      p.classList.toggle('active', p.dataset.mode === mode);
    });
    // body 加 class 給 CSS 用（控制開關的顯隱）
    document.body.classList.toggle('mode-wheel', mode === 'wheel');
    document.body.classList.toggle('mode-slot', mode === 'slot');

    // 切到轉盤時重繪一次
    if (mode === 'wheel') drawWheel();

    // 切換模式後重新計算按鈕狀態
    updateStartButton();
  }

  // ===========================================================
  //                     轉盤繪製 (SVG)
  // ===========================================================
  // 扇形色票（從主調色盤挑，避免跳 tone）
  const WHEEL_COLORS = [
    '#fcd34d', // 鵝黃
    '#f08149', // 暖橘
    '#ff8b5a', // 亮橘
    '#7cb87a', // 減廢綠
    '#fff4d1', // 柔米
    '#e8826e', // 柔紅
    '#ffd9b0', // 淺橘
    '#c4a8d4', // 淡莓紫
  ];

  function drawWheel() {
    if (!el.wheelSvg) return;
    const names = wheelAvailable;
    const n = names.length;
    el.wheelSvg.innerHTML = '';

    // 空狀態：顯示提示
    if (n === 0) {
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', 0);
      txt.setAttribute('y', 0);
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('dominant-baseline', 'middle');
      txt.setAttribute('fill', '#a99985');
      txt.setAttribute('font-size', '18');
      txt.setAttribute('font-family', 'inherit');
      txt.textContent = '';
      el.wheelSvg.appendChild(txt);
      // 背景填色
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      bg.setAttribute('cx', 0);
      bg.setAttribute('cy', 0);
      bg.setAttribute('r', 195);
      bg.setAttribute('fill', '#fff4d1');
      el.wheelSvg.insertBefore(bg, txt);
      return;
    }

    // 只有一個人：整圓填色
    if (n === 1) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', 0);
      circle.setAttribute('cy', 0);
      circle.setAttribute('r', 195);
      circle.setAttribute('fill', WHEEL_COLORS[0]);
      circle.setAttribute('stroke', '#2b1810');
      circle.setAttribute('stroke-width', '1.5');
      circle.classList.add('wheel-slice-path');
      el.wheelSvg.appendChild(circle);

      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', 0);
      txt.setAttribute('y', 0);
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('dominant-baseline', 'middle');
      txt.setAttribute('font-size', fontSizeForName(names[0], 1));
      txt.classList.add('wheel-slice-label');
      txt.textContent = truncateName(names[0]);
      el.wheelSvg.appendChild(txt);
      return;
    }

    const sliceAngle = 360 / n;
    const radius = 195;

    // 依 n 與字長決定字體大小
    names.forEach((name, i) => {
      const startAngle = i * sliceAngle - 90; // -90 讓第 0 格從右側（3 點鐘方向）開始
      const endAngle = startAngle + sliceAngle;

      // 扇形路徑
      const path = describeSlice(0, 0, radius, startAngle, endAngle);
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', path);
      pathEl.setAttribute('fill', WHEEL_COLORS[i % WHEEL_COLORS.length]);
      pathEl.classList.add('wheel-slice-path');
      pathEl.dataset.index = i;
      el.wheelSvg.appendChild(pathEl);

      // 文字：放在扇形中心線上、沿半徑方向
      const midAngle = startAngle + sliceAngle / 2;
      const textR = radius * 0.62; // 文字放在 62% 半徑處
      const rad = (midAngle * Math.PI) / 180;
      const tx = Math.cos(rad) * textR;
      const ty = Math.sin(rad) * textR;

      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', tx);
      txt.setAttribute('y', ty);
      // 沿著半徑方向旋轉：讓文字從圓心指向外側
      txt.setAttribute('transform', `rotate(${midAngle} ${tx} ${ty})`);
      txt.setAttribute('font-size', fontSizeForName(name, n));
      txt.classList.add('wheel-slice-label');
      txt.textContent = truncateName(name);
      el.wheelSvg.appendChild(txt);
    });
  }

  function describeSlice(cx, cy, r, startDeg, endDeg) {
    const s = polar(cx, cy, r, startDeg);
    const e = polar(cx, cy, r, endDeg);
    const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
    return [
      `M ${cx} ${cy}`,
      `L ${s.x} ${s.y}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`,
      'Z',
    ].join(' ');
  }

  function polar(cx, cy, r, deg) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  // 依格數決定字體大小
  function fontSizeForName(name, n) {
    const len = [...name].length;
    let base;
    if (n <= 4) base = 26;
    else if (n <= 8) base = 22;
    else if (n <= 14) base = 17;
    else if (n <= 22) base = 13;
    else base = 11;
    // 長名字再縮
    if (len > 5) base = Math.max(9, base - (len - 5) * 1.5);
    return base;
  }

  function truncateName(name) {
    const chars = [...name];
    if (chars.length > 8) return chars.slice(0, 7).join('') + '…';
    return name;
  }

  // ===========================================================
  //                     轉盤旋轉動畫
  // ===========================================================

  async function spinWheel() {
    if (wheelSpinning) return;
    if (state.prizes.length === 0 || !state.prizes.every((p) => p.name)) {
      showToast('請先設定獎項');
      return;
    }
    if (wheelAvailable.length === 0) {
      showToast('轉盤上沒有參加者了');
      return;
    }

    // 每次只抽一個獎項的一位（轉盤以單次為主）
    // 取用第一個獎項；若獎項人數 >1 則讓使用者重複按 SPIN
    const currentPrize = getCurrentWheelPrize();
    if (!currentPrize) {
      showToast('所有獎項都抽完了！');
      return;
    }

    wheelSpinning = true;
    el.wheelHub.disabled = true;
    el.wheelWrap.classList.add('spinning');
    el.wheelResultName.textContent = '— — —';
    el.wheelResultName.classList.remove('win');
    el.wheelResultDisplay.classList.remove('win');

    el.wheelCurrentPrize.textContent = `正在抽：${currentPrize.name}（第 ${currentPrize.drawnForThisPrize + 1} / ${currentPrize.count} 位）`;
    el.wheelCurrentPrize.classList.add('active');

    // 隨機選中獎者
    const winnerIndex = Math.floor(Math.random() * wheelAvailable.length);
    const winner = wheelAvailable[winnerIndex];

    // 計算需要旋轉到的角度
    // 指針在 3 點鐘方向（0°），winner 格的中心角度 = winnerIndex * sliceAngle + sliceAngle/2（SVG 座標）
    // 目前 SVG 起始從 -90°（12 點）開始繪製扇形，所以第 i 格中心實際在 SVG 的 (i*sliceAngle - 90 + sliceAngle/2)
    // 但因為 SVG 順時針、transform rotate 也是順時針，所以我們要把該格「轉到指針位置（0°）」
    // → 要旋轉的角度 = -(該格中心角度)
    const n = wheelAvailable.length;
    const sliceAngle = 360 / n;
    const sliceCenter = winnerIndex * sliceAngle - 90 + sliceAngle / 2; // SVG 座標角度
    // 在該格中心加一點隨機偏移（±40% of slice）讓視覺自然
    const jitter = (Math.random() - 0.5) * sliceAngle * 0.8;
    const targetAngle = -(sliceCenter + jitter);

    // 加上多轉幾圈
    const extraSpins = 6 + Math.floor(Math.random() * 3); // 6-8 圈
    const finalRotation = wheelRotation + extraSpins * 360 + (targetAngle - (wheelRotation % 360));

    el.wheelSvg.style.transition = 'transform 5.5s cubic-bezier(0.17, 0.67, 0.24, 1)';
    el.wheelSvg.style.transform = `rotate(${finalRotation}deg)`;
    wheelRotation = finalRotation;

    // 轉動中指針碰到邊界會顫動——這裡用固定間隔模擬「經過每格」的 knock
    knockDuringSpin(5500);

    // 等動畫完成
    await sleep(5600);

    el.wheelWrap.classList.remove('spinning');
    el.wheelHub.disabled = false;

    // 高亮中獎扇形
    const winnerSlice = el.wheelSvg.querySelector(`[data-index="${winnerIndex}"]`);
    if (winnerSlice) {
      winnerSlice.classList.add('winner');
      setTimeout(() => winnerSlice.classList.remove('winner'), 2000);
    }

    // 顯示結果
    el.wheelResultName.textContent = winner;
    el.wheelResultName.classList.add('win');
    el.wheelResultDisplay.classList.add('win');
    playCelebration();

    // 記錄
    recordWheelWinner(currentPrize, winner);

    // 如果開啟「中獎後移除」→ 從轉盤拿掉
    if (el.removeAfterWin.checked) {
      state.drawnNames.add(winner);
      wheelAvailable = wheelAvailable.filter((n) => n !== winner);
      // 重繪前先把 svg 的 transform 歸零視覺不跳（保留角度，只重建內容）
      drawWheel();
    }

    wheelSpinning = false;

    // 狀態更新
    updateStartButton();
  }

  function getCurrentWheelPrize() {
    // 找第一個還沒抽滿的獎項
    for (const p of state.prizes) {
      const drawn = wheelPrizeProgress.get(p.id) || 0;
      if (drawn < p.count) {
        return { ...p, drawnForThisPrize: drawn };
      }
    }
    return null;
  }

  function recordWheelWinner(prize, winner) {
    // 更新進度
    wheelPrizeProgress.set(prize.id, (wheelPrizeProgress.get(prize.id) || 0) + 1);

    // 寫入中獎名單（若該獎項已存在，加上去；否則新增）
    let group = state.winners.find((w) => w.prizeId === prize.id);
    if (!group) {
      group = { prizeId: prize.id, prizeName: prize.name, names: [] };
      state.winners.push(group);
    }
    group.names.push(winner);

    // 完成該獎項時切到下一個
    const drawn = wheelPrizeProgress.get(prize.id);
    if (drawn >= prize.count) {
      setTimeout(() => {
        const next = getCurrentWheelPrize();
        if (!next) {
          el.wheelCurrentPrize.textContent = '🎉 全部獎項抽出完畢';
          el.wheelCurrentPrize.classList.remove('active');
          showToast('全部獎項已抽完！');
        } else {
          el.wheelCurrentPrize.textContent = `下一獎：${next.name}（${next.count} 位）`;
        }
      }, 1500);
    }

    renderWinners();
  }

  // 轉動過程中模擬指針敲到扇形邊界
  function knockDuringSpin(durationMs) {
    // 用減速的間隔
    let elapsed = 0;
    const tick = () => {
      if (elapsed >= durationMs) return;
      // 越後面間隔越長（模擬轉慢）
      const progress = elapsed / durationMs;
      const interval = 60 + progress * progress * 400; // 60ms → 460ms
      el.wheelPointer.classList.add('knock');
      setTimeout(() => el.wheelPointer.classList.remove('knock'), 120);
      elapsed += interval;
      setTimeout(tick, interval);
    };
    tick();
  }

  // 點擊 SPIN 或按空白鍵
  el.wheelHub.addEventListener('click', spinWheel);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && currentMode === 'wheel') {
      // 避免在輸入框裡按空白也觸發
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;
      e.preventDefault();
      spinWheel();
    }
  });

  // 獎項變動 → 重設轉盤獎項進度（避免錯亂）
  const origSyncPrizes = syncPrizes;
  // （這邊不額外包裝，因為 prize id 會自動累加，不會重用；進度 Map 用 id 對應沒問題）

  // 初始化 body class
  document.body.classList.add('mode-slot');

  // ---------- 初始化 ----------
  parseParticipants();
  renderWinners();
})();
