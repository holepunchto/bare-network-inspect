// origin-guard.test.mjs — the WS upgrade must reject cross-origin browser pages (CSRF), so a
// random page you visit can't open ws://127.0.0.1:PORT and drive replay. App reporters (no Origin)
// and the served GUI page (same-origin / loopback) must still connect.

import { originAllowed, startGui } from '../packages/p2p-observe/gui/server.mjs';
import net from 'node:net';
import crypto from 'node:crypto';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};
const mk = (origin, host = '127.0.0.1:9491') => ({ headers: { host, ...(origin === undefined ? {} : { origin }) } });

console.log('origin-guard.test.mjs — WS upgrade CSRF guard\n');

// ---- unit: originAllowed ----
check('absent Origin allowed (app reporter, non-browser)', originAllowed(mk(undefined)) === true);
check("'null' Origin allowed (opaque/non-browser)", originAllowed(mk('null')) === true);
check('loopback Origin allowed (localhost)', originAllowed(mk('http://localhost:9491')) === true);
check('loopback Origin allowed (127.0.0.1)', originAllowed(mk('http://127.0.0.1:9491')) === true);
check('same-host Origin allowed (deliberate LAN bind)', originAllowed(mk('http://192.168.1.5:9491', '192.168.1.5:9491')) === true);
check('CONTROL: cross-origin page REJECTED (evil.com)', originAllowed(mk('http://evil.com')) === false);
check('CONTROL: cross-origin https page REJECTED', originAllowed(mk('https://attacker.example')) === false);
check('CONTROL: malformed Origin REJECTED', originAllowed(mk('!!not a url')) === false);

// ---- integration: a real server refuses the cross-origin upgrade, accepts the loopback one ----
const PORT = 9491;
const server = startGui({ port: PORT });
await new Promise((r) => setTimeout(r, 300));

// Raw-socket WS upgrade so we see exactly whether the server sent 101 or destroyed the socket.
function upgrade(origin) {
  return new Promise((resolve) => {
    const sock = net.connect(PORT, '127.0.0.1');
    let buf = '';
    const verdict = () => (buf.startsWith('HTTP/1.1 101') ? 'upgraded' : 'refused');
    sock.on('connect', () => {
      let r = `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n`
        + `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n`;
      if (origin) r += `Origin: ${origin}\r\n`;
      sock.write(r + '\r\n');
    });
    sock.on('data', (d) => { buf += d.toString(); if (buf.includes('\r\n\r\n')) { sock.destroy(); resolve(verdict()); } });
    sock.on('close', () => resolve(verdict()));
    sock.on('error', () => resolve('refused'));
    setTimeout(() => { sock.destroy(); resolve(verdict()); }, 1000);
  });
}

check('CONTROL: server REFUSES cross-origin upgrade (evil.com)', (await upgrade('http://evil.com')) === 'refused');
check('server ACCEPTS loopback upgrade (the GUI page)', (await upgrade(`http://localhost:${PORT}`)) === 'upgraded');
check('server ACCEPTS no-Origin upgrade (app reporter)', (await upgrade(undefined)) === 'upgraded');

server.close();
console.log(failures === 0 ? '\nAll origin-guard claims verified.' : `\n${failures} claim(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
