(() => {
    'use strict';

    const WEEKDAYS = ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日'];
    const WEEKDAY_SHORT = ['月', '火', '水', '木', '金', '土', '日'];
    const VALUES = [-3, -2, -1, 0, 1, 2, 3];
    const MAX_SKIPS = 5;
    const BONUS_POINTS = 5;
    const TIMEOUT_POINTS = 3;
    const $ = (selector, root = document) => root.querySelector(selector);

    const players = [
        { id: 0, name: 'ユーザー1', multipliers: null, prediction: undefined, score: 0, timeoutPoints: 0, bonusPoints: 0, wins: 0, maxPlus: 0 },
        { id: 1, name: 'ユーザー2', multipliers: null, prediction: undefined, score: 0, timeoutPoints: 0, bonusPoints: 0, wins: 0, maxPlus: 0 }
    ];

    let state = {
        phase: 'multipliers',
        settingPlayer: 0,
        year: 2026,
        month: null,
        daysInMonth: 0,
        mode: 'random',
        monthMode: 'random',
        specifiedMonth: 10,
        timeLimit: 20,
        currentPlayer: 0,
        turnNumber: 1,
        usedDays: new Set(),
        actions: [undefined, undefined],
        currentTempDate: null,
        skips: 0,
        log: [],
        message: '',
        result: null,
        endReason: null,
        gameOver: false,
        finalState: null,
        turnStartTimestamp: null,
        previousPhase: null
    };

    let timerInterval = null;
    let activeTimerPhase = null;
    let deadline = null;
    let timeRemaining = 0;
    let multiplierDraft = [3, 2, 1, 0, -1, -2, -3];

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function formatPoints(n) {
        return `${n > 0 ? '+' : ''}${n}`;
    }

    function playerName(id) { return players[id].name; }
    function getDateCount(year, month) { return new Date(year, month, 0).getDate(); }
    function getWeekdayIndex(day) {
        const jsDay = new Date(state.year, state.month - 1, day).getDay();
        return (jsDay + 6) % 7;
    }
    function getWeekdayShort(day) { return WEEKDAY_SHORT[getWeekdayIndex(day)]; }
    function allRemainingDays() {
        const days = [];
        for (let day = 1; day <= state.daysInMonth; day++) {
            if (!state.usedDays.has(day)) days.push(day);
        }
        return days;
    }
    function formatDate(day) {
        return `${state.year}年${state.month}月${day}日（${getWeekdayShort(day)}）`;
    }
    function multiplierLabel(value) {
        return `${value > 0 ? '+' : ''}${value}`;
    }
    function currentPlayerTimerPhase() {
        return state.phase === 'turnSelect1' || state.phase === 'turnSelect2';
    }
    function getLimitForMode() {
        if (state.mode === 'private') return state.timeLimit;
        return 20;
    }
    function timeLimitLabel() {
        const limit = getLimitForMode();
        return limit === 0 ? '無制限' : `${limit}秒`;
    }

    function resetPlayerData() {
        players.forEach(player => {
            player.multipliers = null;
            player.prediction = undefined;
            player.score = 0;
            player.timeoutPoints = 0;
            player.bonusPoints = 0;
            player.wins = 0;
            player.maxPlus = 0;
        });
    }

    function enterPhase(phase) {
        state.phase = phase;
        state.currentTempDate = null;
        activeTimerPhase = null;
        deadline = null;
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        render();
        if (currentPlayerTimerPhase() && getLimitForMode() > 0) startTimerForPhase();
    }

    function startTimerForPhase() {
        if (!currentPlayerTimerPhase()) return;
        const phaseKey = state.phase;
        if (activeTimerPhase === phaseKey && deadline !== null) return;
        activeTimerPhase = phaseKey;
        const seconds = getLimitForMode();
        if (seconds === 0) return;
        deadline = Date.now() + seconds * 1000;
        timeRemaining = seconds;
        updateTimerDisplay();
        timerInterval = setInterval(() => {
            if (state.phase !== phaseKey) {
                clearInterval(timerInterval);
                timerInterval = null;
                return;
            }
            timeRemaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            updateTimerDisplay();
            if (timeRemaining <= 0) {
                clearInterval(timerInterval);
                timerInterval = null;
                activeTimerPhase = null;
                deadline = null;
                chooseNoDate(true);
            }
        }, 200);
    }

    function updateTimerDisplay() {
        const el = $('#timerValue');
        const pill = $('#timerPill');
        if (!el || !pill) return;
        el.textContent = `${timeRemaining}秒`;
        pill.classList.toggle('urgent', timeRemaining <= 5);
    }

    function renderProgress() {
        const steps = [
            { key: 'multipliers', label: '倍率設定', phases: ['multipliers'] },
            { key: 'calendar', label: '年月決定', phases: ['calendar'] },
            { key: 'prediction', label: '最終日予想', phases: ['prediction1', 'prediction2'] },
            { key: 'turns', label: '日付対戦', phases: ['turnSelect1', 'turnSelect2', 'turnResult'] },
            { key: 'result', label: '結果', phases: ['gameOver'] }
        ];
        let activeIndex = steps.findIndex(step => step.phases.includes(state.phase));
        if (activeIndex < 0) activeIndex = 0;
        $('#progress').innerHTML = steps.map((step, index) => {
            const done = index < activeIndex || state.phase === 'gameOver';
            const active = index === activeIndex && state.phase !== 'gameOver';
            return `<div class="progress-step ${done ? 'done' : ''} ${active ? 'active' : ''}"><span class="num">${done ? '✓' : index + 1}</span><span>${step.label}</span></div>`;
        }).join('');
    }

    function renderStatus() {
        const host = $('#statusPanel');
        if (!state.month) {
            host.innerHTML = `
            <div class="side-stat"><span>対戦モード</span><strong>${state.mode === 'private' ? 'プライベート' : state.mode === 'rating' ? 'レート' : 'ランダム'}</strong></div>
            <div class="side-stat"><span>対象年月</span><strong>未決定</strong></div>
            <div class="side-stat"><span>制限時間</span><strong>${timeLimitLabel()}</strong></div>
            <div class="callout" style="margin-top:12px">曜日倍率は各プレイヤーの設定中だけ表示します。相手の倍率は対戦開始時に公開されません。</div>`;
            return;
        }
        const remaining = allRemainingDays().length;
        host.innerHTML = `
          <div class="side-stat"><span>対象年月</span><strong>${state.year}年${state.month}月</strong></div>
          <div class="side-stat"><span>現在のターン</span><strong>${state.turnNumber}</strong></div>
          <div class="side-stat"><span>残り日付</span><strong>${remaining}日</strong></div>
          <div class="side-stat"><span>制限時間</span><strong>${timeLimitLabel()}</strong></div>
          <div class="side-stat"><span>連続スキップ</span><strong>${state.skips} / ${MAX_SKIPS}</strong></div>
          <div class="side-stat"><span>ユーザー1 スコア</span><strong>${formatPoints(players[0].score)}</strong></div>
          <div class="side-stat"><span>ユーザー2 スコア</span><strong>${formatPoints(players[1].score)}</strong></div>
          ${state.skips >= 3 ? '<div class="callout warning" style="margin-top:12px">両者未選択が続いています。5回連続で引き分け終了します。</div>' : ''}`;
    }

    function renderLog() {
        const host = $('#turnLog');
        if (!state.log.length) {
            host.innerHTML = '<div class="empty">対戦開始後に履歴が表示されます。</div>';
            return;
        }
        host.innerHTML = [...state.log].reverse().map(item => `
          <div class="log-item">
            <div class="log-title"><span>第${item.turn}ターン</span><span class="tag ${item.kind === 'skip' ? 'orange' : item.kind === 'same' ? '' : item.kind === 'timeout' ? 'blue' : 'green'}">${escapeHtml(item.tag)}</span></div>
            <div class="log-detail">${escapeHtml(item.detail)}</div>
          </div>`).join('');
    }

    function render() {
        renderProgress();
        renderStatus();
        renderLog();
        const panel = $('#mainPanel');
        if (state.phase === 'multipliers') panel.innerHTML = renderMultiplierScreen();
        else if (state.phase === 'calendar') panel.innerHTML = renderCalendarSetup();
        else if (state.phase === 'prediction1' || state.phase === 'prediction2') panel.innerHTML = renderPredictionScreen();
        else if (state.phase === 'turnSelect1' || state.phase === 'turnSelect2') panel.innerHTML = renderTurnSelection();
        else if (state.phase === 'turnResult') panel.innerHTML = renderTurnResult();
        else if (state.phase === 'gameOver') panel.innerHTML = renderFinalResult();
        attachHandlers();
        if (currentPlayerTimerPhase() && getLimitForMode() > 0 && activeTimerPhase === state.phase) updateTimerDisplay();
    }

    function renderMultiplierScreen() {
        const player = players[state.settingPlayer];
        return `
          <div class="panel-head"><div class="eyebrow">STEP 1 / 5 · PRIVATE SETUP</div><h2>${player.name}：曜日倍率を設定</h2><p class="description">7種類の倍率を、月曜日〜日曜日に重複なく1つずつ割り当ててください。決定後、次のユーザーに画面を渡します。</p></div>
          <div class="panel-body">
            <div class="callout" style="margin-bottom:16px">倍率は対戦開始時に相手へ公開されません。自分の設定だけを確認してから決定してください。</div>
            <div class="setting-tools"><button class="secondary-btn" id="randomizeMultipliers" type="button">ランダムに割り当て</button><button class="quiet-btn" id="resetMultipliers" type="button">初期配置に戻す</button></div>
            <div class="weekday-grid">${WEEKDAYS.map((day, index) => `
              <div class="weekday-row"><div class="weekday-label"><span class="weekday-dot">${WEEKDAY_SHORT[index]}</span><span>${day}</span></div>
                <select class="multiplier-select" data-weekday="${index}" aria-label="${day}の倍率">${VALUES.map(value => `<option value="${value}" ${multiplierDraft[index] === value ? 'selected' : ''}>${multiplierLabel(value)}</option>`).join('')}</select>
              </div>`).join('')}</div>
            <p class="small muted" id="multiplierValidation" style="margin:12px 0 0">未使用の倍率：${getUnusedMultiplierValues().map(multiplierLabel).join('、') || 'なし'}</p>
          </div>
          <div class="panel-foot"><span class="small muted">設定は対戦中に変更できません。</span><button class="primary-btn" id="confirmMultiplier">${state.settingPlayer === 0 ? '決定してユーザー2へ' : '決定して年月設定へ'} →</button></div>`;
    }

    function getUnusedMultiplierValues() {
        return VALUES.filter(value => !multiplierDraft.includes(value));
    }

    function renderCalendarSetup() {
        const years = [];
        for (let year = 2000; year <= 2040; year++) years.push(year);
        const isPrivate = state.mode === 'private';
        return `
          <div class="panel-head"><div class="eyebrow">STEP 2 / 5 · MATCH SETUP</div><h2>対戦年月を決定</h2><p class="description">年を選択し、対象月をランダムに決定します。プライベートマッチでは年月指定も選べます。</p></div>
          <div class="panel-body">
            <div class="form-grid">
              <div class="field"><label for="modeSelect">対戦モード（デモ）</label><select id="modeSelect"><option value="random" ${state.mode === 'random' ? 'selected' : ''}>ランダムマッチ（20秒）</option><option value="rating" ${state.mode === 'rating' ? 'selected' : ''}>レートマッチ（20秒）</option><option value="private" ${state.mode === 'private' ? 'selected' : ''}>プライベートマッチ</option></select><small>マッチング自体は行わず、画面内で2人分を操作します。</small></div>
              <div class="field"><label for="yearSelect">対戦年</label><select id="yearSelect">${years.map(year => `<option value="${year}" ${year === state.year ? 'selected' : ''}>${year}年</option>`).join('')}</select><small>選択した年のカレンダーを使用します。</small></div>
              <div class="field"><label for="monthModeSelect">月の決定方法</label><select id="monthModeSelect" ${isPrivate ? '' : 'disabled'}><option value="random" ${state.monthMode === 'random' ? 'selected' : ''}>ランダムな月</option><option value="specified" ${state.monthMode === 'specified' ? 'selected' : ''}>月を指定</option></select><small>${isPrivate ? 'プライベートマッチのみ月を指定できます。' : 'ランダム・レートマッチは月をランダムに決定します。'}</small></div>
              <div class="field ${isPrivate && state.monthMode === 'specified' ? '' : 'hidden'}" id="specifiedMonthWrap"><label for="specifiedMonth">指定する月</label><select id="specifiedMonth">${Array.from({ length: 12 }, (_, index) => index + 1).map(month => `<option value="${month}" ${month === state.specifiedMonth ? 'selected' : ''}>${month}月</option>`).join('')}</select><small>年月指定時はここで選んだ月を使用します。</small></div>
              <div class="field ${isPrivate ? '' : 'hidden'}" id="timeLimitWrap"><label for="timeLimitSelect">日付選択の制限時間</label><select id="timeLimitSelect"><option value="5" ${state.timeLimit === 5 ? 'selected' : ''}>5秒</option><option value="10" ${state.timeLimit === 10 ? 'selected' : ''}>10秒</option><option value="20" ${state.timeLimit === 20 ? 'selected' : ''}>20秒</option><option value="60" ${state.timeLimit === 60 ? 'selected' : ''}>60秒</option><option value="0" ${state.timeLimit === 0 ? 'selected' : ''}>無制限</option></select><small>デモでの動作確認用です。</small></div>
            </div>
            <div class="callout" style="margin-top:18px"><strong>対戦中の表示：</strong>年月とカレンダーは両ユーザーに公開されますが、曜日倍率と最終日付予想は相手の画面に表示されません。</div>
          </div>
          <div class="panel-foot"><button class="secondary-btn" id="backToUser2">← ユーザー2の設定を見直す</button><button class="primary-btn" id="confirmCalendar">年月を決定 →</button></div>`;
    }

    function renderCalendarGrid({
        selectable = false,
        prediction = false,
        showMultipliers = false,
        multiplierPlayerId = null
    } = {}) {
        const firstDay = (new Date(state.year, state.month - 1, 1).getDay() + 6) % 7;
        const blanks = firstDay; // Monday-first calendar.
        const days = [];
        for (let i = 0; i < blanks; i++) days.push('<div class="calendar-cell blank"></div>');
        for (let day = 1; day <= state.daysInMonth; day++) {
            const used = state.usedDays.has(day);
            const selected = state.currentTempDate === day;
            const isMonthEnd = day === state.daysInMonth;
            const inFirstGroupEdge = day === 1 || day === 5 || day === 6 || day === 10 || day === 11 || day === 15 || day === 16 || day === 20 || day === 21 || day === 25 || day === 26 || day === state.daysInMonth;
            const classes = [
                'day-button', prediction ? 'prediction' : '', used && !prediction ? 'used' : '',
                selected ? 'selected' : '', isMonthEnd ? 'month-end' : '', inFirstGroupEdge ? 'group-edge' : ''
            ].filter(Boolean).join(' ');
            const canClick = selectable || prediction;
            const disabled = (selectable && used) || !canClick ? 'disabled' : '';
            const hint = !prediction && used ? '選択済み' : isMonthEnd ? '月末' : '';
            days.push(`<div class="calendar-cell"><button type="button" class="${classes}" data-day="${day}" ${disabled} aria-label="${day}日${used ? ' 選択済み' : ''}"><span class="day-number">${day}</span><span class="day-hint">${hint}</span></button></div>`);
        }
        const headings = WEEKDAY_SHORT.map((day, index) => {
            const multiplier = showMultipliers && multiplierPlayerId !== null
                ? `<span class="weekday-multiplier">${escapeHtml(
                    multiplierLabel(
                        players[multiplierPlayerId].multipliers[index]
                    )
                )
                }</span>`
                : '';

            return `<div class="calendar-weekday ${index === 6 ? 'sun' : index === 5 ? 'sat' : ''
                }"><span>${day}</span>${multiplier}</div>`;
        }).join('');
        return `<div class="calendar-wrap"><div class="calendar-title"><strong>${state.year}年${state.month}月</strong><span>${state.daysInMonth}日間</span></div><div class="calendar-grid">${headings}${days.join('')}</div></div>`;
    }

    function renderPredictionScreen() {
        const playerId = state.phase === 'prediction1' ? 0 : 1;
        const remaining = allRemainingDays();
        return `
          <div class="panel-head"><div class="eyebrow">STEP 3 / 5 · SECRET PREDICTION</div><h2>${playerName(playerId)}：最後に残る日付を予想</h2><p class="description">ゲーム終了時に残ると予想する日付を1つ選んでください。「日付が残らない」も選べます。</p></div>
          <div class="panel-body">
            <div class="callout" style="margin-bottom:14px">予想が的中すると<strong>+${BONUS_POINTS}ポイント</strong>。予想はゲーム終了まで相手に公開されません。</div>
            ${renderCalendarGrid({ selectable: false, prediction: true })}
            <label class="none-option ${state.currentTempDate === 'none' ? 'active' : ''}" id="nonePredictionOption"><input type="radio" name="prediction" value="none" ${state.currentTempDate === 'none' ? 'checked' : ''}><span><strong>日付が残らない</strong><br><span class="small muted">最後に残る日付が0日と予想する</span></span></label>
          </div>
          <div class="panel-foot"><span class="small muted">現在の選択：${state.currentTempDate === null ? '未選択' : state.currentTempDate === 'none' ? '日付が残らない' : `${state.currentTempDate}日`}</span><button class="primary-btn" id="confirmPrediction" ${state.currentTempDate === null ? 'disabled' : ''}>予想を確定 →</button></div>`;
    }

    function renderTurnSelection() {
        const playerId = state.phase === 'turnSelect1' ? 0 : 1;
        const remaining = allRemainingDays();
        const timerLimit = getLimitForMode();
        return `
          <div class="panel-head"><div class="eyebrow">STEP 4 / 5 · TURN ${state.turnNumber}</div><h2>${playerName(playerId)}：日付を選択</h2><p class="description">残っている日付から1つ選び、決定してください。相手の選択はまだ表示されません。</p></div>
          <div class="panel-body">
            <div class="timer-row"><span class="small muted">${remaining.length}日が選択可能 · 選択した日付は使用済みになります</span>${timerLimit > 0 ? `<span class="timer-pill" id="timerPill"><span>残り</span><strong id="timerValue">${timeRemaining || timerLimit}秒</strong></span>` : '<span class="timer-pill">制限時間：無制限</span>'}</div>
            ${renderCalendarGrid({
                selectable: true,
                showMultipliers: true,
                multiplierPlayerId: playerId
            })
        }
            <div class="selection-summary" style="margin-top:14px">
              <div class="selection-box"><div class="caption">選択中</div><div class="value">${state.currentTempDate === null ? '未選択' : formatDate(state.currentTempDate)}</div></div>
              <div class="selection-box"><div class="caption">このターンの公開</div><div class="value">両者の決定後</div></div>
            </div>
            <div class="callout warning">制限時間切れ時：片方だけが日付を選んでいれば、その日付を消費して選択者に+3点。両者とも未選択ならターンをスキップします。</div>
          </div>
          <div class="panel-foot"><button class="quiet-btn" id="skipSelection">未選択で進む（時間切れ扱い）</button><button class="primary-btn" id="confirmDate" ${state.currentTempDate === null ? 'disabled' : ''}>この日付で決定 →</button></div>`;
    }

    function getGroup(day) {
        if (day <= 5) return 1;
        if (day <= 10) return 2;
        if (day <= 15) return 3;
        if (day <= 20) return 4;
        if (day <= 25) return 5;
        return 6; // 26〜月末（31日を含む）
    }

    function getGroupBounds(group) {
        const ranges = { 1: [1, 5], 2: [6, 10], 3: [11, 15], 4: [16, 20], 5: [21, 25], 6: [26, state.daysInMonth] };
        const [start, end] = ranges[group];
        return [start, Math.min(end, state.daysInMonth)];
    }

    function decideWinner(day0, day1) {
        if (day0 === day1) return { winner: null, reason: '両者が同じ日付を選択したため、得点なし。日付を1つ消費します。', code: 'same' };
        const endDay = state.daysInMonth;
        if ((day0 === endDay && day1 === 1) || (day1 === endDay && day0 === 1)) {
            const winner = day0 === 1 ? 0 : 1;
            return { winner, reason: `月末日（${endDay}日）と1日の対戦：1日を選んだ側が勝利。`, code: 'monthEnd' };
        }
        const group0 = getGroup(day0);
        const group1 = getGroup(day1);
        if (group0 === group1) {
            const [minDay, maxDay] = getGroupBounds(group0);
            if ((day0 === minDay && day1 === maxDay) || (day1 === minDay && day0 === maxDay)) {
                const winner = day0 === minDay ? 0 : 1;
                return { winner, reason: `第${group0}グループの最小日付（${minDay}日）が最大日付（${maxDay}日）に勝利。`, code: 'groupEdge' };
            }
        }
        const winner = day0 > day1 ? 0 : 1;
        return { winner, reason: `通常ルール：大きい日付（${Math.max(day0, day1)}日）が勝利。`, code: 'normal' };
    }

    function addTurnLog(tag, detail, kind = 'normal') {
        state.log.push({ turn: state.turnNumber, tag, detail, kind });
    }

    function recordScore(playerId, points, normalWin = false) {
        const player = players[playerId];
        player.score += points;
        if (normalWin) {
            player.wins += 1;
            if (points > player.maxPlus) player.maxPlus = points;
        }
    }

    function setActionForCurrentPlayer(dayOrNull, timedOut = false) {
        const playerId = state.phase === 'turnSelect1' ? 0 : 1;
        state.actions[playerId] = dayOrNull;
        if (timedOut && timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
            activeTimerPhase = null;
            deadline = null;
        }
        if (playerId === 0) {
            state.currentPlayer = 1;
            state.currentTempDate = null;
            enterPhase('turnSelect2');
        } else {
            resolveTurn();
        }
    }

    function chooseNoDate(timedOut = false) {
        if (!currentPlayerTimerPhase()) return;
        setActionForCurrentPlayer(null, timedOut);
    }

    function confirmSelectedDate() {
        if (!currentPlayerTimerPhase() || typeof state.currentTempDate !== 'number') return;
        const day = state.currentTempDate;
        setActionForCurrentPlayer(day, false);
    }

    function resolveTurn() {
        const first = state.actions[0];
        const second = state.actions[1];
        state.result = null;
        if (first === null && second === null) {
            state.skips += 1;
            addTurnLog('両者未選択', `日付を消費せずにスキップ。連続スキップ ${state.skips}/${MAX_SKIPS} 回。`, 'skip');
            state.result = {
                title: '両者とも未選択',
                detail: `両者とも日付を選択しなかったため、このターンをスキップしました。連続スキップ：${state.skips}/${MAX_SKIPS}回。`,
                kind: 'skip',
                consumed: [],
                points: [0, 0]
            };
            state.actions = [undefined, undefined];
            if (state.skips >= MAX_SKIPS) {
                enterPhase('turnResult');
                return;
            }
            enterPhase('turnResult');
            return;
        }

        if (first === null || second === null) {
            const chosenPlayer = first === null ? 1 : 0;
            const chosenDay = chosenPlayer === 0 ? first : second;
            state.usedDays.add(chosenDay);
            players[chosenPlayer].timeoutPoints += TIMEOUT_POINTS;
            recordScore(chosenPlayer, TIMEOUT_POINTS, false);
            state.skips = 0;
            const detail = `${playerName(chosenPlayer)}だけが${chosenDay}日を選択。相手の時間切れにより${chosenDay}日を消費し、固定+${TIMEOUT_POINTS}点。`;
            addTurnLog('時間切れ処理', detail, 'timeout');
            state.result = { title: '時間切れ処理', detail, kind: 'timeout', consumed: [chosenDay], points: chosenPlayer === 0 ? [TIMEOUT_POINTS, 0] : [0, TIMEOUT_POINTS] };
            state.actions = [undefined, undefined];
            enterPhase('turnResult');
            return;
        }

        state.skips = 0;
        const result = decideWinner(first, second);
        state.usedDays.add(first);
        state.usedDays.add(second); // 同じ日付の場合はSetにより1つだけ消費
        let points = [0, 0];
        if (result.winner !== null) {
            const winnerId = result.winner;
            const winnerDay = winnerId === 0 ? first : second;
            const weekday = getWeekdayIndex(winnerDay);
            const multiplier = players[winnerId].multipliers[weekday];
            const amount = multiplier; // 日付基本スコアは1
            recordScore(winnerId, amount, true);
            points[winnerId] = amount;
        }
        const detail = `${playerName(0)}：${first}日（${getWeekdayShort(first)}）／${playerName(1)}：${second}日（${getWeekdayShort(second)}）。${result.reason}${result.winner === null ? '' : ` ${playerName(result.winner)} ${formatPoints(points[result.winner])}点。`}`;
        const tag = result.winner === null ? '同じ日付' : `${playerName(result.winner)} 勝利`;
        addTurnLog(tag, detail, result.winner === null ? 'same' : 'normal');
        state.result = {
            title: result.winner === null ? '同じ日付：得点なし' : `${playerName(result.winner)}の勝利`,
            detail,
            kind: result.winner === null ? 'same' : 'normal',
            consumed: first === second ? [first] : [first, second],
            points,
            selected: [first, second],
            winner: result.winner
        };
        state.actions = [undefined, undefined];
        enterPhase('turnResult');
    }

    function renderTurnResult() {
        const r = state.result || { title: 'ターン結果', detail: '', kind: 'normal', points: [0, 0], consumed: [] };
        let calloutClass = r.kind === 'skip' ? 'warning' : r.kind === 'timeout' ? 'warning' : r.kind === 'same' ? '' : 'success';
        const points = r.points || [0, 0];
        const remaining = allRemainingDays();
        const forceDraw = state.skips >= MAX_SKIPS;
        const normalFinish = remaining.length <= 1;
        const nextText = forceDraw ? '引き分け結果を確認 →' : normalFinish ? '最終結果へ →' : '次のターンへ →';
        return `
          <div class="panel-head"><div class="eyebrow">TURN ${state.turnNumber} · RESULT</div><h2>ターン結果</h2><p class="description">選択内容と得点処理を確認してください。</p></div>
          <div class="panel-body">
            <div class="callout ${calloutClass}" style="margin-bottom:16px"><strong>${escapeHtml(r.title)}</strong><br>${escapeHtml(r.detail)}</div>
            ${r.selected ? `<div class="selection-summary"><div class="selection-box"><div class="caption">ユーザー1の選択</div><div class="value">${r.selected[0]}日（${getWeekdayShort(r.selected[0])}）</div><div class="small muted">得点 ${formatPoints(points[0])}</div></div><div class="selection-box"><div class="caption">ユーザー2の選択</div><div class="value">${r.selected[1]}日（${getWeekdayShort(r.selected[1])}）</div><div class="small muted">得点 ${formatPoints(points[1])}</div></div></div>` : `<div class="selection-summary"><div class="selection-box"><div class="caption">ユーザー1の今回の得点</div><div class="value">${formatPoints(points[0])}</div></div><div class="selection-box"><div class="caption">ユーザー2の今回の得点</div><div class="value">${formatPoints(points[1])}</div></div></div>`}
            <div class="scoreboard">
              ${players.map((player, id) => `<div class="score-card"><h3>${player.name}</h3><div class="score-value">${formatPoints(player.score)}</div><div class="score-lines"><span>勝利回数：${player.wins}</span><span>最大プラス得点：${formatPoints(player.maxPlus)}</span><span>時間切れ加点：+${player.timeoutPoints}</span></div></div>`).join('')}
            </div>
            <div class="callout" style="margin-top:16px">残り日付：<strong>${remaining.length}日</strong>　／　連続スキップ：<strong>${state.skips}/${MAX_SKIPS}回</strong>${remaining.length === 1 ? `　／　残りは${remaining[0]}日` : remaining.length === 0 ? '　／　残り日付なし' : ''}</div>
            ${forceDraw ? '<div class="callout danger" style="margin-top:12px">連続スキップが5回に達しました。最終スコアに関係なく引き分けで終了します。</div>' : normalFinish ? '<div class="callout success" style="margin-top:12px">残り日付が1日以下になりました。通常の最終予想判定に進みます。</div>' : ''}
          </div>
          <div class="panel-foot"><span class="small muted">次のターンではユーザー1から選択します。</span><button class="primary-btn" id="continueAfterTurn">${nextText}</button></div>`;
    }

    function finishGame(reason = 'normal') {
        state.endReason = reason;
        state.gameOver = true;
        if (reason === 'normal') {
            const remaining = allRemainingDays();
            const finalState = remaining.length === 1 ? remaining[0] : null;
            state.finalState = finalState;
            players.forEach(player => {
                const hit = player.prediction === null ? finalState === null : player.prediction === finalState;
                player.predictionHit = hit;
                player.bonusPoints = hit ? BONUS_POINTS : 0;
            });
        } else {
            state.finalState = null;
            players.forEach(player => {
                player.predictionHit = false;
                player.bonusPoints = 0;
            });
        }
        enterPhase('gameOver');
    }

    function decideFinalWinner() {
        if (state.endReason === 'skip_draw') return { winner: null, label: '引き分け', reason: '両者未選択が5回連続したため、強制引き分け。' };
        const totals = players.map(player => player.score + player.bonusPoints);
        if (totals[0] !== totals[1]) {
            const winner = totals[0] > totals[1] ? 0 : 1;
            return { winner, label: `${playerName(winner)}の勝利`, reason: '最終取得ポイントの比較で勝敗を決定しました。' };
        }
        if (players[0].wins !== players[1].wins) {
            const winner = players[0].wins > players[1].wins ? 0 : 1;
            return { winner, label: `${playerName(winner)}の勝利`, reason: '最終取得ポイントが同点のため、勝利回数で決定しました。' };
        }
        if (players[0].maxPlus !== players[1].maxPlus) {
            const winner = players[0].maxPlus > players[1].maxPlus ? 0 : 1;
            return { winner, label: `${playerName(winner)}の勝利`, reason: 'ポイントと勝利回数が同点のため、最大プラス得点で決定しました。' };
        }
        return { winner: null, label: '引き分け', reason: '最終取得ポイント、勝利回数、最大プラス得点がすべて同じです。' };
    }

    function renderFinalResult() {
        const forcedDraw = state.endReason === 'skip_draw';
        const result = decideFinalWinner();
        const remaining = state.finalState === null ? [] : [state.finalState];
        return `
          <div class="panel-head"><div class="eyebrow">STEP 5 / 5 · FINAL RESULT</div><h2>対戦終了</h2><p class="description">${state.year}年${state.month}月の対戦結果です。</p></div>
          <div class="panel-body">
            <div class="result-banner ${result.winner === null ? '' : 'winner'}"><h3>${escapeHtml(result.label)}</h3><p>${escapeHtml(result.reason)}</p></div>
            ${forcedDraw ? `<div class="callout danger" style="margin-bottom:16px">連続スキップが${MAX_SKIPS}回に達したため、予想ボーナス判定を行わずに引き分けました。</div>` : `<div class="callout ${state.finalState === null ? '' : 'success'}" style="margin-bottom:16px">${state.finalState === null ? '最後に残った日付はありません。' : `最後に残った日付は<strong>${state.finalState}日（${getWeekdayShort(state.finalState)}）</strong>です。`}</div>`}
            <div class="scoreboard">
              ${players.map((player, id) => {
            const total = player.score + player.bonusPoints;
            const winnerClass = result.winner === id ? 'winner' : '';
            const pred = player.prediction === null ? '日付が残らない' : `${player.prediction}日`;
            const hitText = forcedDraw ? '判定なし' : player.predictionHit ? `的中（+${BONUS_POINTS}）` : '不的中（+0）';
            return `<div class="score-card ${winnerClass}"><h3>${player.name}${result.winner === id ? ' · WIN' : ''}</h3><div class="score-value">${formatPoints(total)}</div><div class="score-lines"><span>対戦中スコア：${formatPoints(player.score)}</span><span>時間切れ加点：+${player.timeoutPoints}</span><span>予想ボーナス：+${player.bonusPoints}</span><span>最終予想：${pred}</span><span>予想結果：${hitText}</span><span>勝利回数：${player.wins}</span><span>最大プラス得点：${formatPoints(player.maxPlus)}</span></div></div>`;
        }).join('')}
            </div>
            <div class="callout" style="margin-top:16px">倍率設定は対戦開始時には公開されません。このデモでは、結果画面でも相手の曜日倍率の割り当てを表示しません。</div>
          </div>
          <div class="panel-foot"><span class="small muted">全ターンの履歴は右側に残っています。</span><button class="primary-btn" id="restartGame">もう一度プレイ ↻</button></div>`;
    }

    function refreshMultiplierSelects() {
        const selects = $$('.multiplier-select');
        const values = selects.map(select => Number(select.value));
        const unused = VALUES.filter(value => !values.includes(value));
        const validation = $('#multiplierValidation');
        if (validation) {
            validation.textContent = unused.length ? `未使用の倍率：${unused.map(multiplierLabel).join('、')}` : '7種類の倍率がすべて1回ずつ割り当てられています。';
            validation.className = `small ${unused.length ? 'muted' : ''}`;
        }
        const confirm = $('#confirmMultiplier');
        if (confirm) confirm.disabled = unused.length > 0;
    }

    function randomizeDraft() {
        const shuffled = [...VALUES];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        multiplierDraft = shuffled;
        render();
    }

    function attachHandlers() {
        $$('.multiplier-select').forEach(select => select.addEventListener('change', () => {
            const index = Number(select.dataset.weekday);
            const oldValue = multiplierDraft[index];
            const newValue = Number(select.value);
            const duplicateIndex = multiplierDraft.findIndex((value, otherIndex) => otherIndex !== index && value === newValue);
            if (duplicateIndex >= 0) multiplierDraft[duplicateIndex] = oldValue;
            multiplierDraft[index] = newValue;
            render();
        }));
        const rand = $('#randomizeMultipliers');
        if (rand) rand.addEventListener('click', randomizeDraft);
        const reset = $('#resetMultipliers');
        if (reset) reset.addEventListener('click', () => { multiplierDraft = [3, 2, 1, 0, -1, -2, -3]; render(); });
        const confirmMultiplier = $('#confirmMultiplier');
        if (confirmMultiplier) confirmMultiplier.addEventListener('click', () => {
            if (new Set(multiplierDraft).size !== 7) return;
            players[state.settingPlayer].multipliers = [...multiplierDraft];
            if (state.settingPlayer === 0) {
                state.settingPlayer = 1;
                multiplierDraft = [3, 2, 1, 0, -1, -2, -3];
                render();
            } else {
                enterPhase('calendar');
            }
        });
        const modeSelect = $('#modeSelect');
        if (modeSelect) modeSelect.addEventListener('change', () => {
            state.mode = modeSelect.value;
            if (state.mode !== 'private') { state.monthMode = 'random'; state.timeLimit = 20; }
            render();
        });
        const yearSelect = $('#yearSelect');
        if (yearSelect) yearSelect.addEventListener('change', () => { state.year = Number(yearSelect.value); });
        const monthModeSelect = $('#monthModeSelect');
        if (monthModeSelect) monthModeSelect.addEventListener('change', () => {
            state.monthMode = monthModeSelect.value;
            render();
        });
        const specifiedMonth = $('#specifiedMonth');
        if (specifiedMonth) specifiedMonth.addEventListener('change', () => { state.specifiedMonth = Number(specifiedMonth.value); });
        const timeLimitSelect = $('#timeLimitSelect');
        if (timeLimitSelect) timeLimitSelect.addEventListener('change', () => { state.timeLimit = Number(timeLimitSelect.value); });
        const backToUser2 = $('#backToUser2');
        if (backToUser2) backToUser2.addEventListener('click', () => { state.settingPlayer = 1; multiplierDraft = [...players[1].multipliers]; enterPhase('multipliers'); });
        const confirmCalendar = $('#confirmCalendar');
        if (confirmCalendar) confirmCalendar.addEventListener('click', () => {
            state.year = Number($('#yearSelect').value);
            if (state.mode === 'private') {
                state.monthMode = $('#monthModeSelect').value;
                state.timeLimit = Number($('#timeLimitSelect').value);
                state.month = state.monthMode === 'specified' ? Number($('#specifiedMonth').value) : Math.floor(Math.random() * 12) + 1;
            } else {
                state.monthMode = 'random';
                state.timeLimit = 20;
                state.month = Math.floor(Math.random() * 12) + 1;
            }
            state.daysInMonth = getDateCount(state.year, state.month);
            state.usedDays = new Set();
            state.turnNumber = 1;
            state.skips = 0;
            state.log = [];
            state.actions = [undefined, undefined];
            state.result = null;
            state.gameOver = false;
            state.endReason = null;
            state.finalState = null;
            players.forEach(player => { player.prediction = undefined; player.score = 0; player.timeoutPoints = 0; player.bonusPoints = 0; player.wins = 0; player.maxPlus = 0; });
            enterPhase('prediction1');
        });
        const noneOption = $('#nonePredictionOption');
        if (noneOption) noneOption.addEventListener('click', event => {
            if (event.target.tagName !== 'INPUT') event.preventDefault();
            state.currentTempDate = 'none';
            render();
        });
        $$('.day-button').forEach(button => {
            if (button.disabled) return;
            button.addEventListener('click', () => {
                const day = Number(button.dataset.day);
                if (state.phase === 'prediction1' || state.phase === 'prediction2') state.currentTempDate = day;
                else if (currentPlayerTimerPhase() && !state.usedDays.has(day)) state.currentTempDate = day;
                render();
            });
        });
        const confirmPrediction = $('#confirmPrediction');
        if (confirmPrediction) confirmPrediction.addEventListener('click', () => {
            if (state.currentTempDate === null) return;
            const playerId = state.phase === 'prediction1' ? 0 : 1;
            players[playerId].prediction = state.currentTempDate === 'none' ? null : state.currentTempDate;
            if (playerId === 0) enterPhase('prediction2');
            else {
                state.turnNumber = 1;
                state.skips = 0;
                state.actions = [undefined, undefined];
                enterPhase('turnSelect1');
            }
        });
        const confirmDate = $('#confirmDate');
        if (confirmDate) confirmDate.addEventListener('click', confirmSelectedDate);
        const skipSelection = $('#skipSelection');
        if (skipSelection) skipSelection.addEventListener('click', () => chooseNoDate(false));
        const continueAfterTurn = $('#continueAfterTurn');
        if (continueAfterTurn) continueAfterTurn.addEventListener('click', () => {
            if (state.skips >= MAX_SKIPS) {
                finishGame('skip_draw');
                return;
            }
            if (allRemainingDays().length <= 1) {
                finishGame('normal');
                return;
            }
            state.turnNumber += 1;
            state.actions = [undefined, undefined];
            enterPhase('turnSelect1');
        });
        const restart = $('#restartGame');
        if (restart) restart.addEventListener('click', resetGame);
    }

    function $$(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }

    function resetGame() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        activeTimerPhase = null;
        deadline = null;
        resetPlayerData();
        state = {
            phase: 'multipliers', settingPlayer: 0, year: 2026, month: null, daysInMonth: 0,
            mode: 'random', monthMode: 'random', specifiedMonth: 10, timeLimit: 20,
            currentPlayer: 0, turnNumber: 1, usedDays: new Set(), actions: [undefined, undefined],
            currentTempDate: null, skips: 0, log: [], message: '', result: null, endReason: null,
            gameOver: false, finalState: null, turnStartTimestamp: null, previousPhase: null
        };
        multiplierDraft = [3, 2, 1, 0, -1, -2, -3];
        render();
    }

    // Initialize with a fresh single-page game session.
    render();
})();