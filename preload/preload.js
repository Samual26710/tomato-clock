// 预加载脚本：通过 contextBridge 暴露受控的主进程能力
// 渲染层只能访问这里白名单的接口，不能直接访问 fs / ipcRenderer

const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_LISTEN = new Set(['tray:toggle', 'tray:reset']);

contextBridge.exposeInMainWorld('api', {
  ping: () => 'pong',
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },

  // 持久化
  store: {
    load: () => ipcRenderer.invoke('store:load'),
    saveTasks: (tasks, activeTaskId) =>
      ipcRenderer.invoke('store:saveTasks', { tasks, activeTaskId }),
    appendSession: (session) =>
      ipcRenderer.invoke('store:appendSession', session),
    saveSettings: (patch) =>
      ipcRenderer.invoke('store:saveSettings', patch)
  },

  // 托盘：渲染层每秒同步一次倒计时显示
  tray: {
    update: (payload) => ipcRenderer.send('tray:update', payload)
  },

  // 通知：倒计时归零时
  notify: {
    finished: (payload) => ipcRenderer.send('notify:finished', payload)
  },

  // 监听主进程发来的事件（如托盘菜单点击）
  on: (channel, fn) => {
    if (!ALLOWED_LISTEN.has(channel)) return () => {};
    const wrapped = (_evt, ...args) => fn(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  }
});
