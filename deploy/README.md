# 국내 서버 이전 키트

Render(해외) → 국내 VM 이전용. 목적: ① 국내 IP로 해외차단 소스(todayhumor 등) 재검증 ② `FEED_DB` 영속화(재시작에도 유저 데이터 유지) ③ 상시 가동(콜드스타트 제거) ④ 진짜 velocity(반응 시계열) 저장 기반 마련.

## 역할 분담

**David만 할 수 있는 것 (금지선 — Claude가 대신 못 함):**
1. 클라우드 계정 **생성**(카드 인증 포함) 또는 기존 계정 **로그인**(비밀번호 입력).

**그 외 전부 Claude가 진행:**
- VM 생성(브라우저 콘솔 조작 — David 로그인 후), SSH 키(`~/.ssh/taste-feed-vm` 이미 생성됨), 서버 셋업(`setup.sh`), HTTPS(Caddy 자동), 데이터 이전, DNS.

## 진행 순서

1. **David: 클라우드 계정 로그인** (Oracle Cloud 무료 서울 리전 권장, 또는 Vultr/Lightsail 서울 ~$5/월).
2. **Claude: VM 생성** — Ubuntu 22.04+, 서울 리전. SSH 공개키 등록:
   ```
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEGn0IiZUXfu7re/MuXEWT4ymBtXnLijltiFmMerdtS0 taste-feed-migration
   ```
   80/443 인바운드 허용.
3. **Claude: 셋업** — 로컬에서 SSH 접속 후:
   ```bash
   ssh -i ~/.ssh/taste-feed-vm ubuntu@<VM_IP>
   curl -fsSL https://raw.githubusercontent.com/comeva2kr/ai-command-bus/main/deploy/setup.sh | DOMAIN=<도메인또는공란> bash
   ```
   Docker 설치 → 앱 빌드 → `docker-compose.yml`로 상시 가동(FEED_DB 영속 볼륨 + Caddy HTTPS + FEED_TRANSLATE + 웹푸시)까지 자동.
4. **Claude: 차단 소스 재검증** — 국내 IP에서 todayhumor 등 fetch 테스트 → 되면 `communities.json` enabled.
5. **DNS/도메인** — 도메인 있으면 A레코드 → VM_IP, `.env`의 DOMAIN 갱신 후 재기동(HTTPS 자동). 없으면 임시로 IP:80.
6. **Render 정리** — 국내 검증 완료 후.

## 파일
- `docker-compose.yml` — app + Caddy(자동 HTTPS) + 영속 볼륨
- `Caddyfile` — Let's Encrypt 자동 인증서
- `setup.sh` — VM 원클릭 셋업(Docker·빌드·VAPID·방화벽·기동)

## 주의 (Oracle 무료 티어)
ARM 무료 인스턴스는 리전별 용량 부족(Out of capacity)이 잦음 — 안 되면 잠시 후 재시도하거나 x86 마이크로 인스턴스(항상 무료 2개)로. 카드 인증은 무료 티어라도 필요하나, 명시적 업그레이드 전엔 과금 없음.
