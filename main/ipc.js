// IPC 入口：把 Store 的能力以受控方式暴露给渲染层
// 渲染层不能直接访问 fs，所有读写都走这里

const { ipcMain, app } = require('electron');
const { updateTrayState, notifyFinished } = require('./tray');

function registerIpc(store) {
  // 一次性把所有数据读回去（启动时调用）
  ipcMain.handle('store:load', () => {
    return store.getAll();
  });

  // 任务列表整体保存（实现简单、足够当前规模）
  ipcMain.handle('store:saveTasks', (_evt, payload) => {
    const { tasks, activeTaskId } = payload || {};
    store.saveTasks(tasks, activeTaskId);
    return { ok: true };
  });

  // 追加一条专注会话
  ipcMain.handle('store:appendSession', (_evt, session) => {
    store.appendSession(session);
    return { ok: true };
  });

  // 设置
  ipcMain.handle('store:saveSettings', (_evt, patch) => {
    store.saveSettings(patch);
    return { ok: true };
  });

  // 托盘：每个 tick 同步一次时间和状态
  ipcMain.on('tray:update', (_evt, payload) => {
    updateTrayState(payload || {});
  });

  // 通知：计时完成时发原生通知
  ipcMain.on('notify:finished', (_evt, payload) => {
    notifyFinished(payload || {});
  });

  // 退出前刷盘
  app.on('before-quit', () => {
    store.flush();
  });
}

module.exports = { registerIpc };
