import net from 'node:net';

// Yerel kullanımda localhost/IP/.local; bulut kurulumunda ise yalnızca açıkça
// izin verilen alan adları kabul edilir. Bu kontrol DNS rebinding saldırılarını
// engellemeye yardımcı olur.
function normalizeHost(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader === '') return '';
  let host = hostHeader.toLowerCase().trim();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end === -1) return '';
    return host.slice(1, end);
  }
  if (net.isIP(host) === 0) host = host.replace(/:\d+$/, '');
  return host;
}

export function isTrustedHost(hostHeader) {
  const host = normalizeHost(hostHeader);
  if (!host) return false;

  const configuredHosts = [
    process.env.RENDER_EXTERNAL_HOSTNAME,
    ...(process.env.MONOPOLY_ALLOWED_HOSTS ?? '').split(','),
  ]
    .filter(Boolean)
    .map(value => normalizeHost(value))
    .filter(Boolean);

  return host === 'localhost'
    || net.isIP(host) !== 0
    || (host.endsWith('.local') && host.length > '.local'.length)
    || configuredHosts.includes(host);
}
