// 统计聚合：基于 sessions 数据做时间维度的 rollup
// 设计目标：纯函数式、易测，所有方法接收 sessions 数组，返回聚合结果

(function () {
  /* -------- 工具：时间窗口 -------- */

  /** 当天 0 点的时间戳 */
  function startOfDay(ts = Date.now()) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** 本周一 0 点（中国习惯：周一为一周开始） */
  function startOfWeek(ts = Date.now()) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0=周日, 1=周一, ...
    const diff = (day === 0 ? 6 : day - 1);
    d.setDate(d.getDate() - diff);
    return d.getTime();
  }

  function endOfDay(ts = Date.now()) {
    return startOfDay(ts) + 24 * 3600 * 1000;
  }

  /* -------- 过滤 -------- */

  function inRange(session, fromTs, toTs) {
    const t = session.startAt || 0;
    return t >= fromTs && t < toTs;
  }

  /* -------- 聚合 -------- */

  /**
   * 把 sessions 按"日"分组，返回 { 'YYYY-MM-DD': { focusSec, count } }
   */
  function groupByDay(sessions) {
    const out = {};
    for (const s of sessions) {
      const d = new Date(s.startAt || 0);
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (!out[key]) out[key] = { focusSec: 0, count: 0 };
      out[key].focusSec += s.duration || 0;
      if (s.completed) out[key].count += 1;
    }
    return out;
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /* -------- 对外 API -------- */

  /**
   * 计算总览数据
   * @param {Array} sessions
   * @returns {{
   *   todayFocusSec: number, todayCount: number,
   *   weekFocusSec: number, weekCount: number,
   *   totalFocusSec: number, totalCount: number
   * }}
   */
  function summarize(sessions = []) {
    const todayStart = startOfDay();
    const todayEnd = endOfDay();
    const weekStart = startOfWeek();

    let today = { sec: 0, count: 0 };
    let week  = { sec: 0, count: 0 };
    let total = { sec: 0, count: 0 };

    for (const s of sessions) {
      const sec = s.duration || 0;
      const completed = !!s.completed;
      total.sec += sec;
      if (completed) total.count += 1;

      if (inRange(s, weekStart, todayEnd)) {
        week.sec += sec;
        if (completed) week.count += 1;
      }
      if (inRange(s, todayStart, todayEnd)) {
        today.sec += sec;
        if (completed) today.count += 1;
      }
    }

    return {
      todayFocusSec: today.sec,
      todayCount: today.count,
      weekFocusSec: week.sec,
      weekCount: week.count,
      totalFocusSec: total.sec,
      totalCount: total.count
    };
  }

  /**
   * 最近 N 天的每日数据，用于柱状图
   * @returns {Array<{ date: string, label: string, focusSec: number, count: number }>}
   */
  function recentDays(sessions = [], days = 7) {
    const grouped = groupByDay(sessions);
    const out = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 3600 * 1000);
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      const cell = grouped[key] || { focusSec: 0, count: 0 };
      out.push({ date: key, label, focusSec: cell.focusSec, count: cell.count });
    }
    return out;
  }

  /** 把秒格式化为人类可读 */
  function formatFocus(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${sec}s`;
  }

  /**
   * 连续打卡天数：从今天往前数，连续每天都至少完成 1 个番茄的天数
   * 今天没有 → 看昨天起算（避免上午就显示 0 的反人类体验）
   */
  function streak(sessions = []) {
    if (!sessions.length) return 0;
    const grouped = groupByDay(sessions);

    // 收集所有有完成番茄的日期
    const days = Object.keys(grouped)
      .filter((k) => grouped[k].count > 0)
      .sort()
      .reverse(); // 从近到远
    if (!days.length) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const yesterdayKey = (() => {
      const d = new Date(today.getTime() - 24 * 3600 * 1000);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    })();

    // 起点：今天 / 昨天 / 0
    let cursor;
    if (days[0] === todayKey) cursor = new Date(today);
    else if (days[0] === yesterdayKey) cursor = new Date(today.getTime() - 24 * 3600 * 1000);
    else return 0;

    let count = 0;
    while (true) {
      const key = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`;
      if (grouped[key] && grouped[key].count > 0) {
        count += 1;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return count;
  }

  window.Pomodoro = window.Pomodoro || {};
  window.Pomodoro.Statistics = {
    summarize,
    recentDays,
    groupByDay,
    streak,
    formatFocus,
    startOfDay,
    startOfWeek
  };
})();
