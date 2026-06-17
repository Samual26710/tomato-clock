// 主进程：数据持久化
// 数据文件存在 userData 目录下（Win: %APPDATA%/pomodoro-desktop/data.json）
// 写入用 debounce + 原子替换，避免频繁 IO 和半写损坏

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_STATE = {
  version: 1,
  tasks: [],
  activeTaskId: null,
  sessions: [],
  settings: {
    focusDuration: 25 * 60,
    shortBreak: 5 * 60,
    longBreak: 15 * 60,
    autoStartBreak: false
  }
};

class Store {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'data.json');
    this.state = { ...DEFAULT_STATE };
    this._writeTimer = null;
    this._writing = false;
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        // 浅合并，保留默认结构
        this.state = {
          ...DEFAULT_STATE,
          ...parsed,
          settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) }
        };
      }
    } catch (e) {
      console.error('[store] load failed, using defaults:', e.message);
      // 损坏的文件备份一下
      try {
        if (fs.existsSync(this.filePath)) {
          fs.renameSync(this.filePath, this.filePath + '.broken-' + Date.now());
        }
      } catch (_) {}
      this.state = { ...DEFAULT_STATE };
    }
    return this.state;
  }

  /** 立刻写盘（同步），用于退出前 */
  flush() {
    if (this._writeTimer) {
      clearTimeout(this._writeTimer);
      this._writeTimer = null;
    }
    this._writeNow();
  }

  /** debounce 写盘，连续修改只触发一次实际写入 */
  scheduleWrite(delayMs = 300) {
    if (this._writeTimer) clearTimeout(this._writeTimer);
    this._writeTimer = setTimeout(() => {
      this._writeTimer = null;
      this._writeNow();
    }, delayMs);
  }

  _writeNow() {
    if (this._writing) return;
    this._writing = true;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
      fs.renameSync(tmp, this.filePath); // 原子替换
    } catch (e) {
      console.error('[store] write failed:', e.message);
    } finally {
      this._writing = false;
    }
  }

  /* -------- 业务接口 -------- */

  getAll() {
    return this.state;
  }

  saveTasks(tasks, activeTaskId) {
    this.state.tasks = Array.isArray(tasks) ? tasks : [];
    this.state.activeTaskId = activeTaskId || null;
    this.scheduleWrite();
  }

  appendSession(session) {
    if (!session || !session.id) return;
    this.state.sessions.push(session);
    // 简单防膨胀：只保留最近 1000 条
    if (this.state.sessions.length > 1000) {
      this.state.sessions = this.state.sessions.slice(-1000);
    }
    this.scheduleWrite();
  }

  saveSettings(patch) {
    this.state.settings = { ...this.state.settings, ...(patch || {}) };
    this.scheduleWrite();
  }
}

module.exports = { Store };
