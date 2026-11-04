import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import os from 'node:os';
import qrcode from 'qrcode-terminal';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountRoutes } from './server/routes.js';
import { attachSockets } from './server/socket-handlers.js';
import * as state from './server/state.js';
import { isTrustedHost } from './server/trusted-host.js';
import * as persistence from './server/persistence.js';

function getLanIp() {
  return Object.values(os.networkInterfaces())
    .flat()
    .find(i => i.family === 'IPv4' && !i.internal)?.address ?? 'localhost';
}

// Başka bir sitenin sayfası bu sunucuya WebSocket açamasın: Origin'in host'u, isteğin
// Host başlığıyla aynı olmalı. Origin göndermeyen (tarayıcı olmayan) istemciler geçer.
function allowSameOrigin(req, callback) {
  if (!isTrustedHost(req.headers.host)) return callback(null, false);
  const origin = req.headers.origin;
  if (!origin) return callback(null, true);
  try {
    callback(null, new URL(origin).host === req.headers.host);
  } catch {
    callback(null, false);
  }
}

/**
 * Sunucuyu başlatır. Hem CLI hem Electron main process tarafından çağrılır.
 * @param {object} options
 * @param {number} options.port  0 verilirse OS boş bir port atar. Port doluysa EADDRINUSE ile reddeder.
 * @param {string} [options.publicDir]  Frontend static dosyalarının olduğu klasör (Electron'da packaged path).
 * @param {string} [options.dataFile]  game-state.json'ın yazılacağı tam yol.
 * @param {boolean} [options.printQr]  Konsola QR kodu basılsın mı (CLI true, Electron false).
 * @returns {Promise<{httpServer, io, port, lanUrl, close}>}
 */
export async function startServer({
  port = 3000,
  publicDir,
  dataFile,
  printQr = false,
} = {}) {
  if (publicDir) process.env.MONOPOLY_PUBLIC_DIR = publicDir;
  if (dataFile) persistence.setFile(dataFile);

  const app = express();
  app.use((req, res, next) => {
    if (isTrustedHost(req.headers.host)) return next();
    res.status(403).send('Forbidden');
  });
  const httpServer = createServer(app);
  const io = new Server(httpServer, { allowRequest: allowSameOrigin });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '0.0.0.0', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const actualPort = httpServer.address().port;
  const lanIp = getLanIp();
  const lanUrl = `http://${lanIp}:${actualPort}`;

  await state.init();
  app.get('/api/server-info', (req, res) => {
    // Bulut ortamında QR kodları sunucunun özel LAN IP'sini değil, kullanıcının
    // tarayıcıdan eriştiği gerçek HTTPS adresini kullanmalı.
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0] : req.protocol).trim();
    res.json({ lanUrl: `${protocol}://${req.get('host')}` });
  });
  mountRoutes(app);
  attachSockets(io);

  if (printQr) {
    console.log(`\n🎲 Monopoly Bank hazır:\n  Bankacı: ${lanUrl}/banker\n  Oyuncu:  ${lanUrl}/player\n`);
    qrcode.generate(`${lanUrl}/banker`, { small: true });
  }

  return {
    httpServer,
    io,
    port: actualPort,
    lanUrl,
    close: () => new Promise((resolve) => {
      io.close(() => httpServer.close(resolve));
    }),
  };
}

// CLI olarak çalıştırıldığında otomatik başlat
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await startServer({
    port,
    printQr: true,
    dataFile: process.env.MONOPOLY_DATA_FILE,
  });
}
