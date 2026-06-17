// 任务数据层：纯前端内存实现，后续接入 store + IPC 时只需替换 _persist
// 对外通过事件订阅模式，UI 只关心 onChange。

const TASK_STATUS = Object.freeze({
  ACTIVE: 'active',     // 待办
  DONE: 'done',         // 已完成
  ARCHIVED: 'archived'  // 已归档（暂未启用）
});

class TaskStore {
  constructor() {
    /** @type {Task[]} */
    this._tasks = [];
    /** @type {string|null} 当前选中正在专注的任务 id */
    this._activeTaskId = null;
    /** @type {Set<Function>} */
    this._listeners = new Set();
  }

  /* -------- 订阅 -------- */

  /** 任意变更后会触发，参数为完整快照 */
  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    const snap = this.snapshot();
    this._listeners.forEach((fn) => {
      try { fn(snap); } catch (e) { console.error('[tasks] listener error', e); }
    });
    this._persist(); // 占位：等接入 storage 后会真正写盘
  }

  /* -------- 查询 -------- */

  snapshot() {
    return {
      tasks: this._tasks.map((t) => ({ ...t })),
      activeTaskId: this._activeTaskId,
      activeTask: this.getActive()
    };
  }

  list({ status } = {}) {
    if (!status) return [...this._tasks];
    return this._tasks.filter((t) => t.status === status);
  }

  get(id) {
    return this._tasks.find((t) => t.id === id) || null;
  }

  getActive() {
    if (!this._activeTaskId) return null;
    return this.get(this._activeTaskId);
  }

  /* -------- 写入 -------- */

  create({ title, note = '', estimatedPomodoros = 1 } = {}) {
    const cleanTitle = (title || '').trim();
    if (!cleanTitle) throw new Error('任务标题不能为空');

    /** @type {Task} */
    const task = {
      id: this._genId(),
      title: cleanTitle,
      note,
      estimatedPomodoros: Math.max(1, Number(estimatedPomodoros) || 1),
      completedPomodoros: 0,
      totalFocusSeconds: 0,
      status: TASK_STATUS.ACTIVE,
      createdAt: Date.now(),
      completedAt: null
    };
    this._tasks.unshift(task);

    // 第一次创建时自动激活
    if (!this._activeTaskId) this._activeTaskId = task.id;

    this._emit();
    return task;
  }

  update(id, patch = {}) {
    const t = this.get(id);
    if (!t) return null;

    const allowed = ['title', 'note', 'estimatedPomodoros'];
    allowed.forEach((k) => {
      if (k in patch) t[k] = patch[k];
    });
    if (typeof t.estimatedPomodoros === 'number') {
      t.estimatedPomodoros = Math.max(1, t.estimatedPomodoros);
    }
    this._emit();
    return t;
  }

  /** 标记完成或反向取消完成 */
  toggleDone(id) {
    const t = this.get(id);
    if (!t) return null;

    if (t.status === TASK_STATUS.DONE) {
      t.status = TASK_STATUS.ACTIVE;
      t.completedAt = null;
    } else {
      t.status = TASK_STATUS.DONE;
      t.completedAt = Date.now();
      // 已完成的任务不再作为当前任务
      if (this._activeTaskId === id) this._activeTaskId = null;
    }
    this._emit();
    return t;
  }

  remove(id) {
    const before = this._tasks.length;
    this._tasks = this._tasks.filter((t) => t.id !== id);
    if (this._activeTaskId === id) this._activeTaskId = null;
    if (this._tasks.length !== before) this._emit();
  }

  setActive(id) {
    if (id != null && !this.get(id)) return;
    if (this._activeTaskId === id) return;
    this._activeTaskId = id || null;
    this._emit();
  }

  /**
   * 一次专注会话结束后调用，把数据累加到对应任务上
   * @param {string} taskId
   * @param {number} focusSeconds 实际专注秒数
   * @param {boolean} isPomodoroComplete 是否是完整一颗番茄（倒计时归零）
   */
  recordFocus(taskId, focusSeconds, isPomodoroComplete) {
    const t = this.get(taskId);
    if (!t) return;
    t.totalFocusSeconds += Math.max(0, Math.floor(focusSeconds));
    if (isPomodoroComplete) t.completedPomodoros += 1;
    this._emit();
  }

  /* -------- 工具 -------- */

  _genId() {
    return 'task_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /** 持久化占位，等 store + IPC 接入后实现 */
  _persist() {
    // TODO: window.api.tasks.saveAll(this._tasks, this._activeTaskId)
  }

  /** 等接入持久化后用于初始化 */
  hydrate({ tasks = [], activeTaskId = null } = {}) {
    this._tasks = tasks;
    this._activeTaskId = activeTaskId;
    this._emit();
  }
}

window.Pomodoro = window.Pomodoro || {};
window.Pomodoro.TaskStore = TaskStore;
window.Pomodoro.TASK_STATUS = TASK_STATUS;
