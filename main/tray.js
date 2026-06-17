// 系统托盘：显示剩余时间、右键菜单控制、计时结束通知
// 图标用 dataURL 嵌入的 PNG，避免依赖外部资源文件

const { Tray, Menu, nativeImage, Notification, app } = require('electron');

let tray = null;
let getWindow = () => null;
let onQuit = () => app.quit();
let lastTooltip = '';

// 一个 16×16 的 PNG（红色番茄圆点），base64 内联
// 直接用 dataURL 创建，跨平台稳定
const ICON_DATA_URLS = {
  red:    'data:image/svg+xml;base64,' + Buffer.from(svg('#ff7a7a')).toString('base64'),
  green:  'data:image/svg+xml;base64,' + Buffer.from(svg('#4ec97d')).toString('base64'),
  orange: 'data:image/svg+xml;base64,' + Buffer.from(svg('#ffa84a')).toString('base64'),
  blue:   'data:image/svg+xml;base64,' + Buffer.from(svg('#7ac6ff')).toString('base64')
};

function svg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="6" fill="${color}"/>
    <circle cx="8" cy="8" r="2.5" fill="#fff" opacity="0.85"/>
  </svg>`;
}

function buildIcon(color = 'red') {
  // dataURL 方式 Windows / macOS / Linux 都支持
  const url = ICON_DATA_URLS[color] || ICON_DATA_URLS.red;
  const img = nativeImage.createFromDataURL(url);
  // 某些 Windows 环境对 SVG 支持差，回退到一个 1x1 透明位图
  if (img.isEmpty()) {
    return nativeImage.createEmpty();
  }
  return img;
}

function showWindow() {
  const win = getWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function buildMenu({ isRunning } = {}) {
  return Menu.buildFromTemplate([
    { label: '显示主窗口', click: showWindow },
    { type: 'separator' },
    {
      label: isRunning ? '暂停计时' : '开始/继续',
      click: () => {
        const win = getWindow();
        if (win) win.webContents.send('tray:toggle');
        showWindow();
      }
    },
    {
      label: '重置计时',
      click: () => {
        const win = getWindow();
        if (win) win.webContents.send('tray:reset');
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => onQuit() }
  ]);
}

function createTray(getWindowFn, onQuitFn) {
  getWindow = getWindowFn || (() => null);
  if (typeof onQuitFn === 'function') onQuit = onQuitFn;

  try {
    tray = new Tray(buildIcon('red'));
    tray.setToolTip('番茄钟');
    tray.setContextMenu(buildMenu());
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
  } catch (e) {
    console.error('[tray] create failed:', e.message);
    tray = null;
  }
  return tray;
}

/** 渲染层每秒/每个 tick 调一次：更新 tooltip 和右键菜单状态 */
function updateTrayState({ timeText = '', state = 'idle' } = {}) {
  if (!tray) return;
  const isRunning = state === 'running';
  const tooltip = timeText ? `${timeText} · 番茄钟` : '番茄钟';
  if (tooltip !== lastTooltip) {
    tray.setToolTip(tooltip);
    lastTooltip = tooltip;
  }
  const color = isRunning ? 'green'
              : state === 'paused' ? 'orange'
              : state === 'finished' ? 'blue'
              : 'red';
  try { tray.setImage(buildIcon(color)); } catch (_) {}
  tray.setContextMenu(buildMenu({ isRunning }));
}

/** 计时完成时弹原生通知 */
function notifyFinished({ phase = 'focus', taskTitle = '', focusMinutes = 0 } = {}) {
  if (!Notification.isSupported()) return;

  let body = '';
  if (phase === 'shortBreak') {
    body = '短休息结束，可以开始下一轮专注了';
  } else if (phase === 'longBreak') {
    body = '长休息结束，准备回到专注节奏吧';
  } else {
    body = taskTitle
      ? `「${taskTitle}」专注 ${focusMinutes} 分钟完成`
      : `专注 ${focusMinutes} 分钟完成，休息一下吧`;
  }

  const n = new Notification({
    title: '🍅 番茄钟',
    body,
    silent: false
  });
  n.on('click', showWindow);
  n.show();
}

function destroyTray() {
  if (tray) {
    try { tray.destroy(); } catch (_) {}
    tray = null;
  }
}

module.exports = { createTray, updateTrayState, notifyFinished, destroyTray };
