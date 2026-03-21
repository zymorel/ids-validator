const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.wasm': 'application/wasm',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.mjs':  'application/javascript',
};

const BASE = '/ids-validator';

function startServer(distPath) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = req.url.split('?')[0];

      // Retirer le préfixe /ids-validator
      if (urlPath.startsWith(BASE)) {
        urlPath = urlPath.slice(BASE.length) || '/';
      }
      if (urlPath === '/') urlPath = '/index.html';

      const filePath = path.join(distPath, urlPath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';

      fs.readFile(filePath, (err, data) => {
        if (err) {
          // Fallback SPA → index.html
          fs.readFile(path.join(distPath, 'index.html'), (err2, data2) => {
            if (err2) { res.writeHead(404); res.end('Not found'); }
            else { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(data2); }
          });
        } else {
          res.writeHead(200, { 'Content-Type': mime });
          res.end(data);
        }
      });
    });

    // Port aléatoire sur localhost uniquement
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

async function createWindow() {
  // En production (packagé), dist/ est dans resources/app/dist
  const distPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app', 'dist')
    : path.join(__dirname, '..', 'dist');

  const port = await startServer(distPath);

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'IDS Validator',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Masquer la barre de menu native
  win.setMenuBarVisibility(false);

  win.loadURL(`http://127.0.0.1:${port}${BASE}/`);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
