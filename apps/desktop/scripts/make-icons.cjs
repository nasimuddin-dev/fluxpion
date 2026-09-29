// Generates every TestPion icon and logo size from two sources, using Chromium's renderer:
//   build/logo.svg       the square app mark (gradient "T" + sparkle)
//   build/wordmark.svg   the TestPion wordmark ("Connect every protocol")
//
// Desktop (apps/desktop/build):
//   icon.png             1024×1024  electron-builder source (macOS .icns is derived from it)
//   icon.ico             16–256     Windows app and installer icon (PNG-compressed entries)
//   icons/NxN.png        16–512     Linux icon set
// Website (docs/public):
//   logo.svg                        nav logo, hero image and SVG favicon
//   favicon.ico          16/32/48   browsers without SVG favicons
//   apple-touch-icon.png 180×180
//   icon-192.png, icon-512.png      web app manifest sizes
//   images/testpion-wordmark.png    1200×400 wordmark for the README and docs
//   images/social-preview.jpg       1280×640 link preview (og:image)
//
// Run: npm run icons -w @testpion/desktop
const { app, BrowserWindow } = require('electron');
const { copyFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const build = join(__dirname, '..', 'build');
const site = join(__dirname, '..', '..', '..', 'docs', 'public');

/** Small sizes drop the glow filters and the border so the mark stays crisp. */
const markSvg = (size) => {
  let svg = readFileSync(join(build, 'logo.svg'), 'utf8');
  if (size <= 48) svg = svg.replace(/ filter="url\(#[a-z]+\)"/g, '').replace(/<rect x="6"[^>]*\/>/, '');
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
};
const wordmark = 'data:image/svg+xml;base64,' + readFileSync(join(build, 'wordmark.svg')).toString('base64');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<html></html>');

  /** Draw an image (data URL) into a w×h canvas; `fit` letterboxes it on the image's own edge colour. */
  const render = (src, w, h, { fit = false, type = 'image/png' } = {}) =>
    win.webContents
      .executeJavaScript(
        `new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = ${w}; c.height = ${h};
            const g = c.getContext('2d');
            g.imageSmoothingQuality = 'high';
            if (${fit}) {
              // background: a radial gradient in the image's own background colours (sampled away from the text)
              const s = document.createElement('canvas'); s.width = img.naturalWidth; s.height = img.naturalHeight;
              const sg = s.getContext('2d'); sg.drawImage(img, 0, 0);
              const px = (x, y) => { const d = sg.getImageData(Math.round(x), Math.round(y), 1, 1).data; return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')'; };
              const inner = px(img.naturalWidth / 2, 6), outer = px(4, 4);
              const rg = g.createRadialGradient(${w} / 2, ${h} / 2, 0, ${w} / 2, ${h} / 2, Math.max(${w}, ${h}) * 0.62);
              rg.addColorStop(0, inner); rg.addColorStop(1, outer);
              g.fillStyle = rg; g.fillRect(0, 0, ${w}, ${h});
              // foreground: the whole image, edges feathered into the background
              const scale = Math.min(${w} / img.naturalWidth, ${h} / img.naturalHeight);
              const dw = Math.round(img.naturalWidth * scale), dh = Math.round(img.naturalHeight * scale);
              const f = document.createElement('canvas'); f.width = dw; f.height = dh;
              const fg = f.getContext('2d');
              fg.drawImage(img, 0, 0, dw, dh);
              fg.globalCompositeOperation = 'destination-in';
              const feather = 0.14;
              const v = fg.createLinearGradient(0, 0, 0, dh);
              v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(feather, '#000'); v.addColorStop(1 - feather, '#000'); v.addColorStop(1, 'rgba(0,0,0,0)');
              fg.fillStyle = v; fg.fillRect(0, 0, dw, dh);
              const hz = fg.createLinearGradient(0, 0, dw, 0);
              hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(feather / 2, '#000'); hz.addColorStop(1 - feather / 2, '#000'); hz.addColorStop(1, 'rgba(0,0,0,0)');
              fg.fillStyle = hz; fg.fillRect(0, 0, dw, dh);
              g.drawImage(f, (${w} - dw) / 2, (${h} - dh) / 2);
            } else g.drawImage(img, 0, 0, ${w}, ${h});
            resolve(c.toDataURL('${type}', 0.9));
          };
          img.onerror = () => reject(new Error('could not load image'));
          img.src = ${JSON.stringify(src)};
        })`,
      )
      .then((url) => Buffer.from(url.split(',')[1], 'base64'));

  const mark = (size) => render(markSvg(size), size, size);

  /** An .ico file whose entries are PNG images (supported since Windows Vista). */
  const ico = (pngs) => {
    const header = Buffer.alloc(6 + 16 * pngs.length);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(pngs.length, 4);
    let offset = header.length;
    pngs.forEach(([size, data], i) => {
      const e = 6 + 16 * i;
      header.writeUInt8(size >= 256 ? 0 : size, e);
      header.writeUInt8(size >= 256 ? 0 : size, e + 1);
      header.writeUInt16LE(1, e + 4); // colour planes
      header.writeUInt16LE(32, e + 6); // bits per pixel
      header.writeUInt32LE(data.length, e + 8);
      header.writeUInt32LE(offset, e + 12);
      offset += data.length;
    });
    return Buffer.concat([header, ...pngs.map(([, d]) => d)]);
  };
  const write = (path, data) => {
    writeFileSync(path, data);
    console.log(`wrote ${path.replace(/\\/g, '/').split('/').slice(-3).join('/')} (${data.length} bytes)`);
  };

  // desktop
  write(join(build, 'icon.png'), await mark(1024));
  const winSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  write(join(build, 'icon.ico'), ico(await Promise.all(winSizes.map(async (s) => [s, await mark(s)]))));
  mkdirSync(join(build, 'icons'), { recursive: true });
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) write(join(build, 'icons', `${s}x${s}.png`), await mark(s));

  // website
  copyFileSync(join(build, 'logo.svg'), join(site, 'logo.svg'));
  write(join(site, 'favicon.ico'), ico(await Promise.all([16, 32, 48].map(async (s) => [s, await mark(s)]))));
  write(join(site, 'apple-touch-icon.png'), await mark(180));
  write(join(site, 'icon-192.png'), await mark(192));
  write(join(site, 'icon-512.png'), await mark(512));
  mkdirSync(join(site, 'images'), { recursive: true });
  write(join(site, 'images', 'testpion-wordmark.png'), await render(wordmark, 1200, 400));
  write(join(site, 'images', 'social-preview.jpg'), await render(wordmark, 1280, 640, { fit: true, type: 'image/jpeg' }));
  // the TestPion wordmark without the tagline (gradient "Test", white "Pion", sparkle) for the app's top bar
  // and the website's nav bar; rendered to PNG so the font is the same on every machine. On light
  // backgrounds it sits on a navy badge (CSS), so "Pion" stays white everywhere.
  const nav = readFileSync(join(build, 'wordmark-nav.svg'), 'utf8').replaceAll('PION_COLOR', '#f4f6ff');
  const navPng = await render('data:image/svg+xml;base64,' + Buffer.from(nav).toString('base64'), 600, 150);
  write(join(site, 'wordmark-nav.png'), navPng);
  write(join(build, 'wordmark-nav.png'), navPng);

  app.quit();
});
