// Web Push (RFC 8291 + VAPID / RFC 8292), implemented on node:crypto only —
// no `web-push` dependency, keeping the project zero-dependency.
//
// Two pieces per push:
//   1. VAPID auth: an ES256 JWT signed with the server's VAPID key, identifying
//      us to the push service (Authorization: vapid t=<jwt>, k=<pubkey>).
//   2. Payload encryption: aes128gcm content coding — ECDH to the subscriber's
//      public key, HKDF to derive CEK/nonce, AES-128-GCM over the payload.
//
// The crypto is verifiable offline: encryptPayload/decryptPayload round-trip,
// and the VAPID JWT verifies against its public key (see tests). Actual delivery
// (sendPush) needs network access to the push endpoint.

import crypto from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const fromB64url = (s) => Buffer.from(s, "base64url");

// --- VAPID keys ---

export function generateVapidKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

// Build EC JWK objects from raw VAPID keys so node can sign/verify with them.
function vapidJwk(publicKeyB64, privateKeyB64) {
  const pub = fromB64url(publicKeyB64); // 0x04 || x(32) || y(32)
  const x = b64url(pub.subarray(1, 33));
  const y = b64url(pub.subarray(33, 65));
  const base = { kty: "EC", crv: "P-256", x, y };
  const priv = privateKeyB64 ? { ...base, d: b64url(fromB64url(privateKeyB64)) } : base;
  return { public: base, private: priv };
}

// A signed VAPID JWT for a given push endpoint audience.
export function vapidJwt(endpoint, keys, subject = "mailto:admin@example.com", ttlSec = 12 * 3600, nowSec) {
  const aud = new URL(endpoint).origin;
  const now = nowSec || Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64url(JSON.stringify({ aud, exp: now + ttlSec, sub: subject }));
  const signingInput = `${header}.${payload}`;
  const jwk = vapidJwk(keys.publicKey, keys.privateKey).private;
  const key = crypto.createPrivateKey({ key: jwk, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(sig)}`;
}

export function verifyVapidJwt(jwt, publicKeyB64) {
  const [h, p, s] = jwt.split(".");
  const jwk = vapidJwk(publicKeyB64).public;
  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  return crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, fromB64url(s));
}

// --- aes128gcm payload encryption (RFC 8291) ---

// Derive the shared HKDF input keying material from an ECDH secret + auth secret.
function deriveIkm(sharedSecret, authSecret, recipientPub, senderPub) {
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), recipientPub, senderPub]);
  return Buffer.from(crypto.hkdfSync("sha256", sharedSecret, authSecret, info, 32));
}

function deriveKeyNonce(ikm, salt) {
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  return { cek, nonce };
}

// Encrypt a payload for a subscription ({ keys: { p256dh, auth } }). Returns the
// aes128gcm body Buffer ready to POST. `salt`/`senderKeys` are injectable for
// deterministic tests.
export function encryptPayload(subscription, payload, opts = {}) {
  const recipientPub = fromB64url(subscription.keys.p256dh);
  const authSecret = fromB64url(subscription.keys.auth);

  const ecdh = crypto.createECDH("prime256v1");
  if (opts.senderPrivate) ecdh.setPrivateKey(fromB64url(opts.senderPrivate));
  else ecdh.generateKeys();
  const senderPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(recipientPub);

  const salt = opts.salt ? fromB64url(opts.salt) : crypto.randomBytes(16);
  const ikm = deriveIkm(shared, authSecret, recipientPub, senderPub);
  const { cek, nonce } = deriveKeyNonce(ikm, salt);

  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([0x02])]); // 0x02 = last-record delimiter
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const enc = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  return Buffer.concat([salt, rs, Buffer.from([senderPub.length]), senderPub, enc]);
}

// Inverse of encryptPayload, using the recipient's private key. For tests /
// verification (a real subscriber's UA does this).
export function decryptPayload(body, recipientKeys) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const senderPub = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);

  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(fromB64url(recipientKeys.private));
  const shared = ecdh.computeSecret(senderPub);
  const recipientPub = fromB64url(recipientKeys.p256dh);
  const authSecret = fromB64url(recipientKeys.auth);

  const ikm = deriveIkm(shared, authSecret, recipientPub, senderPub);
  const { cek, nonce } = deriveKeyNonce(ikm, salt);

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  // strip the trailing 0x02 delimiter + any padding
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0x00) end--;
  return plain.subarray(0, end); // drops the 0x02 delimiter byte
}

// Send a push. Needs network access to the endpoint. Returns { status }.
export async function sendPush(subscription, payload, keys, opts = {}) {
  const body = encryptPayload(subscription, payload);
  const jwt = vapidJwt(subscription.endpoint, keys, opts.subject);
  const res = await (opts.fetchImpl || fetch)(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(opts.ttl || 86400)
    },
    body
  });
  return { status: res.status };
}

// --- digest push fan-out (server-side re-engagement job) ---

// Check every subscribed user's non-consuming digest (engine.digest) and push
// the ones that actually have unseen matches right now. `sendImpl` stands in
// for sendPush in tests so this runs with no network access; production wiring
// (server.js) leaves it unset and gets the real thing. The payload shape
// { title, body, url } matches what public/sw.js's `push` handler expects:
// title/body go straight into showNotification, url is carried through
// notification.data so a click opens the right in-app deep link.
export async function sendDigestPushes(store, engine, vapidKeys, opts = {}) {
  const send = opts.sendImpl || sendPush;
  const limit = opts.limit || 5;
  let sent = 0;
  let failed = 0;
  if (!vapidKeys || !vapidKeys.publicKey || !vapidKeys.privateKey) return { sent, failed };

  for (const user of store.users.values()) {
    const sub = user.pushSubscription;
    if (!sub || !sub.endpoint) continue; // no real subscription (or the VAPID-less local-only fallback)

    let digest;
    try {
      digest = await engine.digest(user.id, { limit });
    } catch {
      continue; // e.g. user disappeared mid-loop; skip rather than fail the whole batch
    }
    if (!digest || !digest.count) continue; // nothing new — stay quiet

    // never put a 19금 title on a lock screen (same principle as the share
    // page): preview the first non-adult match, or stay generic
    const top = (digest.top || []).find((t) => !t.adult);
    const payload = JSON.stringify({
      title: "내 취향 피드",
      body: `관심글 ${digest.count}개가 올라왔어요` + (top ? ` · ${top.title.slice(0, 30)}` : ""),
      url: top ? `/#post-${top.id}` : "/"
    });

    try {
      await send(sub, payload, vapidKeys, { subject: vapidKeys.subject });
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  return { sent, failed };
}
