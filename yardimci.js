const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KLASOR = __dirname;
const ayarlar = JSON.parse(fs.readFileSync(path.join(KLASOR, 'ayarlar.json'), 'utf-8'));

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jetonOlustur() {
  const privateKeyPath = path.join(KLASOR, ayarlar.PRIVATE_KEY_FILE);
  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf-8');
  const header = { alg: 'ES256', kid: ayarlar.KEY_ID, id: `${ayarlar.TEAM_ID}.${ayarlar.SERVICE_ID}` };
  const simdi = Math.floor(Date.now() / 1000);
  const payload = { iss: ayarlar.TEAM_ID, iat: simdi, exp: simdi + 3600, sub: ayarlar.SERVICE_ID };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const imzalanacak = `${headerB64}.${payloadB64}`;
  const imza = crypto.sign('sha256', Buffer.from(imzalanacak), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });
  return `${imzalanacak}.${base64url(imza)}`;
}

module.exports = { ayarlar, jetonOlustur, KLASOR };
