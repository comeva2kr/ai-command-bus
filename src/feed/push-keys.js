// Generates a VAPID (RFC 8292) keypair and prints the environment variables
// needed to enable real Web Push delivery. Run once per deployment and keep
// the private key secret (treat it like any other server credential).
//
// Usage: npm run push:keys

import { generateVapidKeys } from "./push.js";

const { publicKey, privateKey } = generateVapidKeys();

console.log("VAPID keypair generated. Set these before starting the server:\n");
console.log(`  VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`  VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`  VAPID_SUBJECT=mailto:admin@example.com   # 실제 연락처로 바꾸세요\n`);
console.log(
  "VAPID_PRIVATE_KEY는 비밀로 유지하세요 — 서버가 푸시 서비스에 자신을 증명하는 서명 키입니다."
);
console.log("설정 후 GET /api/push/vapid-key 가 공개키를 반환하고, 클라이언트의 '알림 받기'가");
console.log("실제 Web Push 구독을 생성합니다 (미설정 시 로컬 알림으로만 동작).");
