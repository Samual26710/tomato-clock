const { app, BrowserWindow } = require('electron');
const path = require('path');
const { Store } = require('./store');
const { registerIpc } = require('./ipc');
const { createTray, destroyTray } = require('./tray');

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow = null;
let store = null;

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 820,
    minWidth: 380,
    minHeight: 640,
    title: '番茄钟',
    backgroundColor: '#1e1e2e',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icons', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getMainWindow() {
  return mainWindow;
}

app.on('second-instance', () => {
  showMainWindow();
});

app.whenReady().then(() => {
  store = new Store();
  store.load();

  registerIpc(store, getMainWindow);
  createMainWindow();
  createTray(getMainWindow, () => {
    app.isQuitting = true;
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else showMainWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  // 桌面应用通常保持在托盘运行；用户从托盘退出会调用 app.quit()
  // macOS 习惯保留进程
});

app.on('quit', () => {
  destroyTray();
});
