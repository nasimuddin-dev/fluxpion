// Rasterises build/logo.svg into build/icon.png (1024×1024) using Chromium's SVG renderer.
// The SVG is drawn onto a canvas, so the result doesn't depend on window or screen size.
// electron-builder derives the Windows .ico, macOS .icns and Linux icons from icon.png.
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SIZE = 1024;
app.whenReady().then(async () => {
  const build = join(__dirname, '..', 'build');
  const svg = readFileSync(join(build, 'logo.svg'), 'utf8');
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<html></html>');
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = ${SIZE};
      c.getContext('2d').drawImage(img, 0, 0, ${SIZE}, ${SIZE});
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
  })`);
  writeFileSync(join(build, 'icon.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote build/icon.png');
  app.quit();
});
