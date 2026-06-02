const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, shell } = require('electron');

let localServer;

async function startServer() {
  const serverModulePath = pathToFileURL(
    path.join(__dirname, '..', 'scripts', 'local-phone-server.mjs'),
  ).href;
  const { startLocalPhoneServer } = await import(serverModulePath);
  localServer = await startLocalPhoneServer({
    root: path.join(__dirname, '..', 'dist', 'local-phone'),
    host: '127.0.0.1',
    port: 0,
    quiet: true,
  });
  return localServer.url;
}

async function createWindow() {
  const url = await startServer();
  const win = new BrowserWindow({
    width: 430,
    height: 820,
    minWidth: 390,
    minHeight: 680,
    title: '小手机本地版',
    backgroundColor: '#f5f7fb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  await win.loadURL(url);
}

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  localServer?.server?.close();
});
