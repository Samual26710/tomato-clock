// 渲染进程主控制器：装配 Timer + Tasks + UI + IPC

(function bootstrap() {
  const { Timer, formatTime, TaskStore, Statistics } = window.Pomodoro;

  const DEFAULT_SETTINGS = Object.freeze({
    focusDuration: 25 * 60,
    shortBreak: 5 * 60,
    longBreak: 15 * 60,
    autoStartBreak: false
  });

  const PHASE = Object.freeze({
    FOCUS: 'focus',
    SHORT_BREAK: 'shortBreak',
    LONG_BREAK: 'longBreak'
  });

  // —— DOM 引用 ——
  const $timeDisplay = document.getElementById('time-display');
  const $stateLabel = document.getElementById('state-label');
  const $btnToggle = document.getElementById('btn-toggle');
  const $btnReset = document.getElementById('btn-reset');
  const $ringProgress = document.querySelector('.ring-progress');
  const $modeBtns = document.querySelectorAll('.mode-btn');
  const $presetBtns = document.querySelectorAll('.preset-btn');
  const $presetWrap = document.getElementById('duration-presets');
  const $bootHint = document.getElementById('boot-hint');
  const $btnOpenSettings = document.getElementById('btn-open-settings');

  const $activeTask = document.getElementById('active-task');
  const $activeTitle = document.getElementById('active-task-title');
  const $taskList = document.getElementById('task-list');
  const $tasksEmpty = document.getElementById('tasks-empty');
  const $btnAddTask = document.getElementById('btn-add-task');

  const $taskModal = document.getElementById('task-modal');
  const $taskModalTitle = document.getElementById('task-modal-title');
  const $inputTitle = document.getElementById('input-title');
  const $inputEstimate = document.getElementById('input-estimate');
  const $inputNote = document.getElementById('input-note');
  const $btnTaskSave = document.getElementById('btn-modal-save');
  const $btnTaskCancel = document.getElementById('btn-modal-cancel');

  const $settingsModal = document.getElementById('settings-modal');
  const $inputFocusDuration = document.getElementById('input-focus-duration');
  const $inputShortBreak = document.getElementById('input-short-break');
  const $inputLongBreak = document.getElementById('input-long-break');
  const $inputAutoStartBreak = document.getElementById('input-auto-start-break');
  const $btnSettingsSave = document.getElementById('btn-settings-save');
  const $btnSettingsCancel = document.getElementById('btn-settings-cancel');

  // 统计面板
  const $statTodayFocus = document.getElementById('stat-today-focus');
  const $statTodayPomodoros = document.getElementById('stat-today-pomodoros');
  const $statWeekFocus = document.getElementById('stat-week-focus');
  const $statStreak = document.getElementById('stat-streak');

  const api = window.api || null;

  // —— 数据层 ——
  const tasks = new TaskStore();

  tasks.subscribe((snap) => {
    renderTasks();
    if (api?.store?.saveTasks) {
      api.store.saveTasks(snap.tasks, snap.activeTaskId);
    }
  });

  // —— 计时器 ——
  const timer = new Timer({
    mode: 'countdown',
    duration: DEFAULT_SETTINGS.focusDuration,
    onTick: handleTick,
    onStateChange: handleStateChange,
    onFinish: handleFinish
  });

  let editingId = null;
  let trayThrottleAt = 0;
  let sessions = [];
  let phase = PHASE.FOCUS;
  let settings = { ...DEFAULT_SETTINGS };

  function isBreakPhase(value = phase) {
    return value === PHASE.SHORT_BREAK || value === PHASE.LONG_BREAK;
  }

  function getPhaseLabel(value = phase) {
    if (value === PHASE.SHORT_BREAK) return '短休息';
    if (value === PHASE.LONG_BREAK) return '长休息';
    return '专注';
  }

  function getPhaseDuration(value = phase) {
    if (value === PHASE.SHORT_BREAK) return settings.shortBreak;
    if (value === PHASE.LONG_BREAK) return settings.longBreak;
    return settings.focusDuration;
  }

  function clampInt(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, Math.round(num)));
  }

  function normalizeStoredSettings(raw = {}) {
    return {
      focusDuration: clampInt(raw.focusDuration, 60, 180 * 60, DEFAULT_SETTINGS.focusDuration),
      shortBreak: clampInt(raw.shortBreak, 60, 60 * 60, DEFAULT_SETTINGS.shortBreak),
      longBreak: clampInt(raw.longBreak, 60, 120 * 60, DEFAULT_SETTINGS.longBreak),
      autoStartBreak: !!raw.autoStartBreak
    };
  }

  function getStateText(snap) {
    const state = snap.state;

    if (snap.mode === 'countup') {
      if (state === 'running') return '正计时中';
      if (state === 'paused') return '正计时已暂停';
      if (state === 'finished') return '已完成';
      return '准备开始';
    }

    if (!isBreakPhase()) {
      if (state === 'running') return '专注中';
      if (state === 'paused') return '专注已暂停';
      if (state === 'finished') return '专注完成';
      return '准备开始';
    }

    const label = getPhaseLabel();
    if (state === 'running') return `${label}中`;
    if (state === 'paused') return `${label}已暂停`;
    if (state === 'finished') return `${label}结束`;
    return `${label}待开始`;
  }

  function syncPresetButtons() {
    $presetBtns.forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.dataset.seconds) === settings.focusDuration);
    });
  }

  function persistSettings(patch) {
    settings = { ...settings, ...patch };
    if (api?.store?.saveSettings) {
      api.store.saveSettings(patch);
    }
  }

  function configureCountdownPhase(nextPhase) {
    phase = nextPhase;
    timer.configure({ mode: 'countdown', duration: getPhaseDuration(nextPhase) });
  }

  function queueFocusPhase({ start = false } = {}) {
    configureCountdownPhase(PHASE.FOCUS);
    if (start) timer.start();
  }

  function queueBreakPhase(nextPhase, { start = false } = {}) {
    configureCountdownPhase(nextPhase);
    if (start) timer.start();
  }

  function refreshCurrentTimerFromSettings() {
    if (timer.mode !== 'countdown' || timer.isRunning || timer.isPaused) return;
    timer.configure({ mode: 'countdown', duration: getPhaseDuration() });
  }

  function getCompletedFocusCount() {
    return sessions.filter((session) => {
      if (!session?.completed) return false;
      if (session.phase === PHASE.FOCUS) return true;
      return !session.phase && session.mode === 'countdown';
    }).length;
  }

  function getNextBreakPhase() {
    return getCompletedFocusCount() % 4 === 0 ? PHASE.LONG_BREAK : PHASE.SHORT_BREAK;
  }

  /* ============== Stats 渲染 ============== */

  function renderStats() {
    if (!Statistics) return;
    const sum = Statistics.summarize(sessions);
    const streak = Statistics.streak(sessions);

    $statTodayFocus.textContent = Statistics.formatFocus(sum.todayFocusSec);
    $statTodayPomodoros.textContent = String(sum.todayCount);
    $statWeekFocus.textContent = Statistics.formatFocus(sum.weekFocusSec);
    $statStreak.textContent = String(streak);
  }

  /* ============== Timer 渲染 + 托盘同步 ============== */

  function pushTrayUpdate(snap, force = false) {
    if (!api?.tray?.update) return;
    const now = Date.now();
    if (!force && now - trayThrottleAt < 1000) return;
    trayThrottleAt = now;
    api.tray.update({
      timeText: formatTime(snap.displaySec),
      state: snap.state
    });
  }

  function handleTick(snap) {
    renderTimer(snap);
    pushTrayUpdate(snap, false);
  }

  function handleStateChange(snap) {
    renderTimer(snap);
    pushTrayUpdate(snap, true);
  }

  function renderTimer(snap) {
    const s = snap || timer.snapshot();
    const breakPhase = s.mode === 'countdown' && isBreakPhase();

    $timeDisplay.textContent = formatTime(s.displaySec);
    $stateLabel.textContent = getStateText(s);

    const offset = 1 - Math.max(0, Math.min(1, s.progress));
    $ringProgress.setAttribute('stroke-dashoffset', String(offset));
    $ringProgress.classList.toggle('is-countup', s.mode === 'countup');
    $ringProgress.classList.toggle('is-break', breakPhase);

    if (s.state === 'running') {
      $btnToggle.textContent = '暂停';
      $btnToggle.classList.add('is-running');
    } else if (s.state === 'paused') {
      $btnToggle.textContent = '继续';
      $btnToggle.classList.remove('is-running');
    } else {
      $btnToggle.textContent = breakPhase ? '开始休息' : '开始';
      $btnToggle.classList.remove('is-running');
    }

    $btnReset.textContent = breakPhase ? '跳过休息' : '重置';

    const lock = s.state === 'running' || s.state === 'paused' || breakPhase;
    $modeBtns.forEach((btn) => { btn.disabled = lock; });
    $presetBtns.forEach((btn) => { btn.disabled = lock; });
  }

  function appendFocusSession(activeTask, snap, focusSec) {
    const session = {
      id: 'sess_' + Date.now().toString(36),
      taskId: activeTask ? activeTask.id : null,
      mode: snap.mode,
      phase: PHASE.FOCUS,
      startAt: snap.startedAt || Date.now() - focusSec * 1000,
      duration: focusSec,
      completed: true
    };

    sessions.push(session);
    renderStats();

    if (api?.store?.appendSession) {
      api.store.appendSession(session);
    }
  }

  function notifyPhaseFinished(payload) {
    if (api?.notify?.finished) {
      api.notify.finished(payload);
    }
  }

  function handleFocusFinish(snap) {
    const active = tasks.getActive();
    const focusSec = snap.elapsedSec || snap.duration;

    if (active) {
      tasks.recordFocus(active.id, focusSec, true);
    }

    appendFocusSession(active, snap, focusSec);
    notifyPhaseFinished({
      phase: PHASE.FOCUS,
      taskTitle: active ? active.title : '',
      focusMinutes: Math.max(1, Math.round(focusSec / 60))
    });

    const nextBreakPhase = getNextBreakPhase();
    queueBreakPhase(nextBreakPhase, { start: settings.autoStartBreak });
  }

  function handleBreakFinish() {
    notifyPhaseFinished({ phase });
    queueFocusPhase();
  }

  function handleFinish(snap) {
    if (snap.mode !== 'countdown') return;
    if (phase === PHASE.FOCUS) handleFocusFinish(snap);
    else handleBreakFinish();
  }

  function handleResetAction() {
    if (timer.mode === 'countdown' && isBreakPhase()) {
      queueFocusPhase();
      return;
    }
    timer.reset();
  }

  /* ============== Tasks 渲染 ============== */

  function renderTasks() {
    const list = tasks.list();
    const active = tasks.getActive();

    if (active) {
      $activeTitle.textContent = active.title;
      $activeTask.classList.remove('is-empty');
    } else {
      $activeTitle.textContent = '未选择，点下方任务即可';
      $activeTask.classList.add('is-empty');
    }

    $taskList.innerHTML = '';
    list.forEach((task) => $taskList.appendChild(buildTaskItem(task, active && active.id === task.id)));
    $tasksEmpty.classList.toggle('hidden', list.length > 0);
  }

  function buildTaskItem(task, isActive) {
    const li = document.createElement('li');
    li.className = 'task-item';
    li.dataset.id = task.id;
    if (isActive) li.classList.add('is-active');
    if (task.status === 'done') li.classList.add('is-done');

    li.innerHTML = `
      <button class="task-check" data-action="toggle-done" title="${task.status === 'done' ? '撤销完成' : '标记完成'}">
        ${task.status === 'done' ? '✓' : ''}
      </button>
      <div class="task-body" data-action="select">
        <div class="task-title"></div>
        <div class="task-meta">🍅 ${task.completedPomodoros}/${task.estimatedPomodoros} · ${formatFocusShort(task.totalFocusSeconds)}</div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn" data-action="edit" title="编辑">✎</button>
        <button class="task-action-btn is-danger" data-action="delete" title="删除">✕</button>
      </div>
    `;
    li.querySelector('.task-title').textContent = task.title;

    li.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'toggle-done') {
        tasks.toggleDone(task.id);
      } else if (action === 'edit') {
        openTaskModal(task);
      } else if (action === 'delete') {
        if (confirm(`确定删除任务「${task.title}」？`)) tasks.remove(task.id);
      } else if (action === 'select') {
        if (task.status !== 'done') tasks.setActive(task.id);
      }
    });

    return li;
  }

  function formatFocusShort(sec) {
    if (!sec) return '0m';
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  /* ============== 任务弹层 ============== */

  function isTaskModalOpen() {
    return !$taskModal.classList.contains('hidden');
  }

  function openTaskModal(task) {
    closeSettingsModal();
    editingId = task ? task.id : null;
    $taskModalTitle.textContent = task ? '编辑任务' : '新建任务';
    $inputTitle.value = task ? task.title : '';
    $inputEstimate.value = task ? task.estimatedPomodoros : 1;
    $inputNote.value = task ? task.note : '';
    $taskModal.classList.remove('hidden');
    setTimeout(() => $inputTitle.focus(), 50);
  }

  function closeTaskModal() {
    $taskModal.classList.add('hidden');
    editingId = null;
  }

  function saveTaskModal() {
    const title = $inputTitle.value.trim();
    if (!title) {
      $inputTitle.focus();
      return;
    }

    const estimate = Math.max(1, Math.min(20, Number($inputEstimate.value) || 1));
    const note = $inputNote.value.trim();

    if (editingId) {
      tasks.update(editingId, { title, estimatedPomodoros: estimate, note });
    } else {
      const created = tasks.create({ title, estimatedPomodoros: estimate, note });
      if (!tasks.getActive()) tasks.setActive(created.id);
    }

    closeTaskModal();
  }

  /* ============== 设置弹层 ============== */

  function isSettingsModalOpen() {
    return !$settingsModal.classList.contains('hidden');
  }

  function openSettingsModal() {
    closeTaskModal();
    $inputFocusDuration.value = Math.round(settings.focusDuration / 60);
    $inputShortBreak.value = Math.round(settings.shortBreak / 60);
    $inputLongBreak.value = Math.round(settings.longBreak / 60);
    $inputAutoStartBreak.checked = settings.autoStartBreak;
    $settingsModal.classList.remove('hidden');
    setTimeout(() => $inputFocusDuration.focus(), 50);
  }

  function closeSettingsModal() {
    $settingsModal.classList.add('hidden');
  }

  function saveSettingsModal() {
    const nextSettings = {
      focusDuration: clampInt($inputFocusDuration.value, 1, 180, Math.round(settings.focusDuration / 60)) * 60,
      shortBreak: clampInt($inputShortBreak.value, 1, 60, Math.round(settings.shortBreak / 60)) * 60,
      longBreak: clampInt($inputLongBreak.value, 1, 120, Math.round(settings.longBreak / 60)) * 60,
      autoStartBreak: $inputAutoStartBreak.checked
    };

    persistSettings(nextSettings);
    syncPresetButtons();
    refreshCurrentTimerFromSettings();
    closeSettingsModal();
  }

  /* ============== 事件绑定 ============== */

  $btnToggle.addEventListener('click', () => timer.toggle());
  $btnReset.addEventListener('click', handleResetAction);

  $modeBtns.forEach((btn) => btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode === timer.mode) return;

    $modeBtns.forEach((item) => item.classList.toggle('is-active', item === btn));
    $presetWrap.classList.toggle('is-hidden', mode === 'countup');

    if (mode === 'countup') {
      phase = PHASE.FOCUS;
      timer.configure({ mode: 'countup' });
      return;
    }

    queueFocusPhase();
    syncPresetButtons();
  }));

  $presetBtns.forEach((btn) => btn.addEventListener('click', () => {
    const seconds = Number(btn.dataset.seconds);
    persistSettings({ focusDuration: seconds });
    syncPresetButtons();
    if (timer.mode === 'countdown' && !isBreakPhase()) {
      timer.configure({ duration: seconds });
    }
  }));

  $btnAddTask.addEventListener('click', () => openTaskModal(null));
  $btnTaskCancel.addEventListener('click', closeTaskModal);
  $btnTaskSave.addEventListener('click', saveTaskModal);
  $taskModal.addEventListener('click', (e) => {
    if (e.target === $taskModal) closeTaskModal();
  });

  $btnOpenSettings.addEventListener('click', openSettingsModal);
  $btnSettingsCancel.addEventListener('click', closeSettingsModal);
  $btnSettingsSave.addEventListener('click', saveSettingsModal);
  $settingsModal.addEventListener('click', (e) => {
    if (e.target === $settingsModal) closeSettingsModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isTaskModalOpen()) closeTaskModal();
      if (isSettingsModalOpen()) closeSettingsModal();
      return;
    }

    if (e.key !== 'Enter') return;
    if (isTaskModalOpen() && e.target !== $inputNote) saveTaskModal();
    if (isSettingsModalOpen()) saveSettingsModal();
  });

  if (api?.on) {
    api.on('tray:toggle', () => timer.toggle());
    api.on('tray:reset', handleResetAction);
  }

  /* ============== 启动：从持久化加载 ============== */

  async function init() {
    if (api?.store?.load) {
      try {
        const data = await api.store.load();

        if (Array.isArray(data?.tasks)) {
          tasks.hydrate({ tasks: data.tasks, activeTaskId: data.activeTaskId });
        }

        if (Array.isArray(data?.sessions)) {
          sessions = data.sessions;
        }

        settings = normalizeStoredSettings(data?.settings || DEFAULT_SETTINGS);
        syncPresetButtons();
        queueFocusPhase();

        $bootHint.textContent = `Electron ${api.versions.electron} · 已加载 ${data?.tasks?.length || 0} 个任务`;
      } catch (e) {
        $bootHint.textContent = '⚠ 数据加载失败：' + e.message;
      }
    } else {
      syncPresetButtons();
      $bootHint.textContent = '⚠ Preload 未生效';
    }

    renderTimer();
    renderTasks();
    renderStats();
  }

  init();
})();
