// 计时核心：倒计时 + 正计时
// 用 performance.now() + requestAnimationFrame 做漂移补偿，
// 比 setInterval 更准，标签页/窗口被节流时也能在恢复时一次性补齐时间。

const STATE = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  FINISHED: 'finished'
});

const MODE = Object.freeze({
  COUNTDOWN: 'countdown',
  COUNTUP: 'countup'
});

class Timer {
  /**
   * @param {Object} opts
   * @param {'countdown'|'countup'} opts.mode
   * @param {number} opts.duration  倒计时时长（秒）；正计时模式下忽略
   * @param {(snap: TimerSnapshot) => void} [opts.onTick]
   * @param {(snap: TimerSnapshot) => void} [opts.onFinish]
   * @param {(snap: TimerSnapshot) => void} [opts.onStateChange]
   */
  constructor({ mode = MODE.COUNTDOWN, duration = 25 * 60, onTick, onFinish, onStateChange } = {}) {
    this.mode = mode;
    this.duration = duration;          // 仅倒计时使用
    this.elapsedMs = 0;                // 已累计毫秒
    this.state = STATE.IDLE;

    this.onTick = onTick || (() => {});
    this.onFinish = onFinish || (() => {});
    this.onStateChange = onStateChange || (() => {});

    this._rafId = null;
    this._lastFrameAt = 0;             // performance.now() 的时间戳
    this._startedAt = 0;               // 本次会话起点（Date.now()），统计用
  }

  /* -------- 公共属性 -------- */

  get isRunning() { return this.state === STATE.RUNNING; }
  get isPaused()  { return this.state === STATE.PAUSED; }
  get isIdle()    { return this.state === STATE.IDLE; }
  get isFinished(){ return this.state === STATE.FINISHED; }

  /** 当前应显示的秒数（倒计时显示剩余、正计时显示已用） */
  get displaySeconds() {
    const elapsedSec = Math.floor(this.elapsedMs / 1000);
    if (this.mode === MODE.COUNTDOWN) {
      return Math.max(0, this.duration - elapsedSec);
    }
    return elapsedSec;
  }

  /** 进度比 0~1（仅倒计时有意义；正计时永远返回 0） */
  get progress() {
    if (this.mode !== MODE.COUNTDOWN || this.duration <= 0) return 0;
    return Math.min(1, this.elapsedMs / 1000 / this.duration);
  }

  /* -------- 控制 API -------- */

  start() {
    if (this.state === STATE.RUNNING) return;
    if (this.state === STATE.FINISHED || this.state === STATE.IDLE) {
      this.elapsedMs = 0;
      this._startedAt = Date.now();
    }
    this._setState(STATE.RUNNING);
    this._lastFrameAt = performance.now();
    this._loop();
  }

  pause() {
    if (this.state !== STATE.RUNNING) return;
    this._stopLoop();
    this._setState(STATE.PAUSED);
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this._setState(STATE.RUNNING);
    this._lastFrameAt = performance.now();
    this._loop();
  }

  /** 开始/暂停/继续 三合一，UI 用一个按钮就行 */
  toggle() {
    if (this.isRunning) this.pause();
    else if (this.isPaused) this.resume();
    else this.start();
  }

  reset() {
    this._stopLoop();
    this.elapsedMs = 0;
    this._startedAt = 0;
    this._setState(STATE.IDLE);
    this.onTick(this.snapshot());
  }

  /** 切换模式或调整时长。会重置状态。 */
  configure({ mode, duration } = {}) {
    this._stopLoop();
    if (mode) this.mode = mode;
    if (typeof duration === 'number' && duration > 0) this.duration = duration;
    this.elapsedMs = 0;
    this._startedAt = 0;
    this._setState(STATE.IDLE);
    this.onTick(this.snapshot());
  }

  /** 本次会话的快照，给统计模块用 */
  snapshot() {
    return {
      mode: this.mode,
      state: this.state,
      duration: this.duration,
      elapsedMs: this.elapsedMs,
      elapsedSec: Math.floor(this.elapsedMs / 1000),
      remainingSec: this.mode === MODE.COUNTDOWN
        ? Math.max(0, this.duration - Math.floor(this.elapsedMs / 1000))
        : 0,
      displaySec: this.displaySeconds,
      progress: this.progress,
      startedAt: this._startedAt
    };
  }

  /* -------- 内部 -------- */

  _setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange(this.snapshot());
  }

  _loop() {
    const tick = (now) => {
      const delta = now - this._lastFrameAt;
      this._lastFrameAt = now;
      this.elapsedMs += delta;

      // 倒计时归零：触发 finish
      if (this.mode === MODE.COUNTDOWN && this.elapsedMs >= this.duration * 1000) {
        this.elapsedMs = this.duration * 1000;
        this._stopLoop();
        this._setState(STATE.FINISHED);
        const snap = this.snapshot();
        this.onTick(snap);
        this.onFinish(snap);
        return;
      }

      this.onTick(this.snapshot());
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopLoop() {
    if (this._rafId != null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }
}

/** 把秒格式化为 mm:ss 或 hh:mm:ss */
function formatTime(totalSec) {
  totalSec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

window.Pomodoro = window.Pomodoro || {};
window.Pomodoro.Timer = Timer;
window.Pomodoro.TIMER_STATE = STATE;
window.Pomodoro.TIMER_MODE = MODE;
window.Pomodoro.formatTime = formatTime;
