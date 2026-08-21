const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // 伪造 utools 基础全局变量，防止原版 UI 因找不到 API 崩溃
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(`
      window.utools = window.utools || {
        isDarkColors: () => true,
        onPluginEnter: (cb) => cb({ code: 'renamer', type: 'files', payload: [] }),
        onPluginOut: () => {},
        showOpenDialog: (opts) => {},
        db: { promises: { get: () => null, put: () => {} } }
      };
    `);
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});