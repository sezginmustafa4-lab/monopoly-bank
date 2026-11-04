import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedHost } from '../../server/trusted-host.js';

test('hosts a player can legitimately type are trusted', () => {
  for (const host of ['localhost:3737', 'LOCALHOST', '127.0.0.1:3000', '192.168.1.42:3000', '[::1]:3737', 'mac.local:3737']) {
    assert.equal(isTrustedHost(host), true, host);
  }
});

test('a host name that could be rebound to this machine is not trusted', () => {
  for (const host of ['evil.example:3737', 'localhost.evil.example', '127.0.0.1.evil.example', '', undefined]) {
    assert.equal(isTrustedHost(host), false, String(host));
  }
});


test('configured public hostnames are trusted without allowing arbitrary domains', () => {
  const previous = process.env.MONOPOLY_ALLOWED_HOSTS;
  process.env.MONOPOLY_ALLOWED_HOSTS = 'game.example.com, play.example.com';
  try {
    assert.equal(isTrustedHost('game.example.com'), true);
    assert.equal(isTrustedHost('play.example.com:443'), true);
    assert.equal(isTrustedHost('evil.example.com'), false);
  } finally {
    if (previous === undefined) delete process.env.MONOPOLY_ALLOWED_HOSTS;
    else process.env.MONOPOLY_ALLOWED_HOSTS = previous;
  }
});
