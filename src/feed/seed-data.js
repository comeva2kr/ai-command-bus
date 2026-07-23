// Offline seed dataset.
//
// Mimics what a cross-community aggregator would pull in: "best" posts from a
// spread of communities plus news articles, tagged so the recommender has
// something to learn from with no network access. `source` is the community or
// outlet name; `kind` is "community" or "news".

export const SEED_ITEMS = [
  // --- tech / IT ---
  { kind: "news", source: "techwire", category: "tech", tags: ["ai", "programming"], title: "새 오픈소스 LLM, 코드 생성 벤치마크서 상용 모델 추월", score: 412, commentCount: 88, author: "editor", length: 640, publishedAt: "2026-07-06T09:10:00Z" },
  { kind: "community", source: "clien", category: "tech", tags: ["hardware", "mobile"], title: "새 폰 배터리 이틀 가는 거 실화냐...충격받고 옴", score: 305, commentCount: 142, author: "gadgetlover", length: 120, publishedAt: "2026-07-06T08:40:00Z" },
  { kind: "community", source: "clien", category: "tech", tags: ["programming", "career"], title: "10년차 개발자인데 요즘 AI 때문에 현타 오는 사람?", score: 520, commentCount: 233, author: "devnote", length: 340, publishedAt: "2026-07-06T07:00:00Z" },
  { kind: "news", source: "techwire", category: "tech", tags: ["security"], title: "대형 클라우드 취약점 공개...패치 서두르라 권고", score: 180, commentCount: 34, author: "editor", length: 520, publishedAt: "2026-07-06T06:20:00Z" },
  { kind: "community", source: "ruliweb", category: "tech", tags: ["ai", "startup"], title: "1인 개발자가 만든 앱이 앱스토어 1위 찍은 후기", score: 388, commentCount: 97, author: "solodev", length: 410, publishedAt: "2026-07-05T22:15:00Z" },

  // --- automotive ---
  { kind: "community", source: "bobae", category: "auto", tags: ["cars", "testdrive"], title: "신형 그랜저 2주 타본 솔직 시승기 (장단점 정리)", score: 590, commentCount: 210, author: "carguy", length: 820, publishedAt: "2026-07-06T08:10:00Z" },
  { kind: "news", source: "autopost", category: "auto", tags: ["cars", "ev"], title: "국산 전기차 신모델 공개...1회 충전 600km 주행", score: 470, commentCount: 132, author: "editor", length: 560, publishedAt: "2026-07-06T06:30:00Z" },
  { kind: "community", source: "bobae", category: "auto", tags: ["cars", "advice"], title: "첫차로 이 두 모델 고민 중인데 조언 좀 부탁드려요", score: 320, commentCount: 245, author: "firstcar", length: 260, publishedAt: "2026-07-06T05:20:00Z" },
  { kind: "news", source: "autopost", category: "auto", tags: ["testdrive", "cars"], title: "수입 SUV 3종 비교 시승...승차감 승자는?", score: 380, commentCount: 88, author: "editor", length: 900, publishedAt: "2026-07-05T21:00:00Z" },
  { kind: "community", source: "bobae", category: "auto", tags: ["ev", "cars"], title: "전기차 3년 타보니 유지비 이렇게 나옵니다 (실제 데이터)", score: 510, commentCount: 190, author: "evowner", length: 640, publishedAt: "2026-07-05T18:00:00Z" },
  { kind: "community", source: "clien", category: "auto", tags: ["cars", "hardware"], title: "요즘 신차 옵션 왜 이렇게 복잡함...정리해봄", score: 240, commentCount: 76, author: "techcar", length: 300, publishedAt: "2026-07-05T16:40:00Z" },
  { kind: "community", source: "bobae", category: "auto", tags: ["motorcycle", "cars"], title: "출퇴근 바이크 입문 6개월 후기 (돈 굳는 이야기)", score: 210, commentCount: 64, author: "rider", length: 340, publishedAt: "2026-07-05T14:10:00Z" },
  { kind: "community", source: "getcha", category: "auto", tags: ["cars", "testdrive"], title: "겟차 시승 이벤트 다녀옴...신형 세단 실내가 반전", score: 360, commentCount: 102, author: "getchafan", length: 480, publishedAt: "2026-07-06T07:40:00Z" },
  { kind: "community", source: "getcha", category: "auto", tags: ["cars", "advice"], title: "신차 할인 지금이 맞을까...견적 공유하고 조언 구함", score: 280, commentCount: 158, author: "buyer", length: 220, publishedAt: "2026-07-05T20:20:00Z" },
  { kind: "community", source: "encar", category: "auto", tags: ["cars", "advice"], title: "중고차 사기 전에 이것만은 꼭 확인하세요 (체크리스트)", score: 440, commentCount: 176, author: "usedcarpro", length: 700, publishedAt: "2026-07-06T04:00:00Z" },
  { kind: "community", source: "encar", category: "auto", tags: ["cars", "ev"], title: "중고 전기차 배터리 상태 확인하는 법 정리", score: 300, commentCount: 91, author: "encaruser", length: 520, publishedAt: "2026-07-05T17:50:00Z" },

  // --- science ---
  { kind: "news", source: "sciencedaily", category: "science", tags: ["space"], title: "제임스웹, 지구형 외계행성 대기서 수증기 흔적 포착", score: 640, commentCount: 120, author: "editor", length: 720, publishedAt: "2026-07-06T05:00:00Z" },
  { kind: "news", source: "sciencedaily", category: "science", tags: ["biology"], title: "노화 되돌리는 세포 리프로그래밍, 쥐 실험서 진전", score: 470, commentCount: 76, author: "editor", length: 680, publishedAt: "2026-07-05T18:30:00Z" },
  { kind: "community", source: "clien", category: "science", tags: ["physics", "space"], title: "블랙홀 관련 유튜브 정주행하다 밤샜다 ㅋㅋ 추천 좀", score: 210, commentCount: 55, author: "curious", length: 90, publishedAt: "2026-07-05T16:00:00Z" },
  { kind: "news", source: "sciencedaily", category: "science", tags: ["climate"], title: "올여름 해수면 온도 역대 최고치 경신", score: 330, commentCount: 210, author: "editor", length: 590, publishedAt: "2026-07-06T04:10:00Z" },

  // --- business / economy ---
  { kind: "news", source: "marketpost", category: "business", tags: ["markets"], title: "코스피 장중 3000 회복...외국인 순매수 전환", score: 290, commentCount: 88, author: "editor", length: 480, publishedAt: "2026-07-06T00:30:00Z" },
  { kind: "community", source: "ppomppu", category: "business", tags: ["crypto", "markets"], title: "코인 물타기 세 번째...이번엔 진짜 반등 오냐", score: 260, commentCount: 301, author: "hodler", length: 150, publishedAt: "2026-07-06T02:00:00Z" },
  { kind: "community", source: "ppomppu", category: "business", tags: ["realestate"], title: "전세 만기인데 집주인이 수리비 떠넘기려 함...조언 부탁", score: 175, commentCount: 189, author: "tenant", length: 220, publishedAt: "2026-07-06T01:15:00Z" },
  { kind: "news", source: "marketpost", category: "business", tags: ["startup", "career"], title: "국내 스타트업 상반기 투자 유치액 30% 감소", score: 140, commentCount: 42, author: "editor", length: 510, publishedAt: "2026-07-05T20:00:00Z" },

  // --- gaming ---
  { kind: "community", source: "ruliweb", category: "gaming", tags: ["console", "pc-gaming"], title: "이번 신작 GOTY 확정인가...30시간 플레이 후기", score: 555, commentCount: 176, author: "gamer99", length: 430, publishedAt: "2026-07-06T03:30:00Z" },
  { kind: "community", source: "ruliweb", category: "gaming", tags: ["esports"], title: "결승전 마지막 세트 역대급이었다...직관 후기", score: 480, commentCount: 260, author: "fan", length: 200, publishedAt: "2026-07-05T23:00:00Z" },
  { kind: "news", source: "gamespot", category: "gaming", tags: ["pc-gaming", "hardware"], title: "차세대 그래픽카드 스펙 유출...가격이 관건", score: 220, commentCount: 91, author: "editor", length: 470, publishedAt: "2026-07-05T21:40:00Z" },
  { kind: "community", source: "inven", category: "gaming", tags: ["mobile", "console"], title: "과금 없이 만렙 찍은 무과금러의 꿀팁 정리", score: 340, commentCount: 130, author: "f2p", length: 380, publishedAt: "2026-07-05T19:20:00Z" },

  // --- sports ---
  { kind: "news", source: "sportsline", category: "sports", tags: ["football"], title: "손흥민 결승골...팀 공식전 5연승 질주", score: 700, commentCount: 320, author: "editor", length: 400, publishedAt: "2026-07-06T07:50:00Z" },
  { kind: "community", source: "mlbpark", category: "sports", tags: ["baseball"], title: "우리 팀 마무리 방화 이제 못 참겠다 (feat. 눈물)", score: 410, commentCount: 288, author: "diehard", length: 180, publishedAt: "2026-07-06T06:45:00Z" },
  { kind: "community", source: "mlbpark", category: "sports", tags: ["basketball"], title: "NBA 트레이드 루머 정리해봄...우리 팀은?", score: 230, commentCount: 104, author: "hoops", length: 260, publishedAt: "2026-07-05T17:30:00Z" },

  // --- culture / entertainment ---
  { kind: "community", source: "theqoo", category: "culture", tags: ["kdrama"], title: "어제 드라마 결말 실화냐...작가님 왜 그러셨어요", score: 620, commentCount: 410, author: "watcher", length: 210, publishedAt: "2026-07-06T08:00:00Z" },
  { kind: "news", source: "entnews", category: "culture", tags: ["movies"], title: "여름 텐트폴 영화 개봉 첫날 100만 돌파", score: 280, commentCount: 66, author: "editor", length: 450, publishedAt: "2026-07-06T02:30:00Z" },
  { kind: "community", source: "theqoo", category: "culture", tags: ["music", "celebrity"], title: "이번 컴백 무대 미쳤다...직캠 보고 입덕함", score: 500, commentCount: 340, author: "stan", length: 130, publishedAt: "2026-07-05T22:50:00Z" },
  { kind: "news", source: "entnews", category: "culture", tags: ["celebrity"], title: "톱배우 열애설 인정...소속사 공식 입장", score: 350, commentCount: 220, author: "editor", length: 300, publishedAt: "2026-07-06T09:30:00Z" },

  // --- life / hobby ---
  { kind: "community", source: "82cook", category: "life", tags: ["food"], title: "에어프라이어로 3분 만에 만든 야식 레시피 공유", score: 310, commentCount: 95, author: "cookie", length: 240, publishedAt: "2026-07-06T04:40:00Z" },
  { kind: "community", source: "clien", category: "life", tags: ["travel"], title: "혼자 다녀온 5박6일 일본 소도시 여행기 (사진 많음)", score: 430, commentCount: 88, author: "wanderer", length: 900, publishedAt: "2026-07-05T15:00:00Z" },
  { kind: "community", source: "82cook", category: "life", tags: ["fitness", "advice"], title: "3개월 만에 10kg 감량한 식단 루틴 정리", score: 390, commentCount: 150, author: "healthfreak", length: 560, publishedAt: "2026-07-05T13:20:00Z" },
  { kind: "community", source: "theqoo", category: "life", tags: ["pets"], title: "우리 강아지 처음으로 웃었어요 (인생네컷)", score: 480, commentCount: 112, author: "dogmom", length: 60, publishedAt: "2026-07-06T05:30:00Z" },
  { kind: "community", source: "82cook", category: "life", tags: ["parenting", "advice"], title: "돌 지난 아기 밤에 안 자는데 다들 어떻게 버티셨어요", score: 200, commentCount: 176, author: "newparent", length: 190, publishedAt: "2026-07-05T12:00:00Z" },

  // --- humor / daily ---
  { kind: "community", source: "dcinside", category: "humor", tags: ["meme"], title: "회사 단톡방에서 오타 하나로 벌어진 대참사.jpg", score: 810, commentCount: 264, author: "anon", length: 40, publishedAt: "2026-07-06T09:00:00Z" },
  { kind: "community", source: "dcinside", category: "humor", tags: ["meme", "story"], title: "택배 아저씨가 남긴 메모 보고 하루종일 웃음", score: 640, commentCount: 140, author: "anon", length: 70, publishedAt: "2026-07-06T07:20:00Z" },
  { kind: "community", source: "instiz", category: "humor", tags: ["story"], title: "시끄럽다고 휴대폰 끈 친구...결말이 ㅋㅋㅋㅋ", score: 520, commentCount: 98, author: "anon", length: 110, publishedAt: "2026-07-06T06:10:00Z" },
  { kind: "community", source: "dcinside", category: "humor", tags: ["meme"], title: "이런 걸 돈 주고 사 먹어? ㅋㅋㅋ", score: 470, commentCount: 205, author: "anon", length: 30, publishedAt: "2026-07-05T22:20:00Z" },
  { kind: "community", source: "humoruniv", category: "humor", tags: ["meme", "story"], title: "웃대 레전드 짤 다시 봐도 미쳤다 ㅋㅋㅋㅋㅋ", score: 720, commentCount: 180, author: "anon", length: 40, publishedAt: "2026-07-06T08:30:00Z" },
  { kind: "community", source: "humoruniv", category: "humor", tags: ["story", "advice"], title: "알바하다 겪은 손님 레전드 썰 푼다", score: 560, commentCount: 240, author: "anon", length: 160, publishedAt: "2026-07-06T05:50:00Z" },
  { kind: "community", source: "humoruniv", category: "humor", tags: ["meme"], title: "우리 아빠 카톡 프로필 상태메시지 근황.jpg", score: 480, commentCount: 88, author: "anon", length: 30, publishedAt: "2026-07-05T21:30:00Z" },

  // --- politics / world ---
  { kind: "news", source: "newswire", category: "politics", tags: ["policy", "election"], title: "여야, 예산안 처리 놓고 막판 진통...본회의 연기", score: 190, commentCount: 430, author: "editor", length: 540, publishedAt: "2026-07-06T08:20:00Z" },
  { kind: "news", source: "newswire", category: "politics", tags: ["policy"], title: "정부, 청년 주거 지원 대책 발표...실효성 논란", score: 160, commentCount: 380, author: "editor", length: 500, publishedAt: "2026-07-06T03:00:00Z" },
  { kind: "news", source: "newswire", category: "news", tags: ["world"], title: "캐나다 잠수함 도입 확정 아닌 것 같다...현지 보도", score: 145, commentCount: 72, author: "editor", length: 420, publishedAt: "2026-07-06T01:30:00Z" },
  { kind: "news", source: "newswire", category: "news", tags: ["world", "climate"], title: "유럽 폭염 경보 확대...주요 도시 40도 육박", score: 210, commentCount: 66, author: "editor", length: 460, publishedAt: "2026-07-05T20:40:00Z" },

  // --- general news mix ---
  { kind: "news", source: "newswire", category: "news", tags: ["policy"], title: "430억짜리 해양레저파크 '부실 개장' 논란", score: 175, commentCount: 130, author: "editor", length: 380, publishedAt: "2026-07-05T23:53:00Z" },
  { kind: "community", source: "bobae", category: "news", tags: ["advice", "story"], title: "세입자 수전 교체해준다 VS 소모품이니 안 해준다", score: 260, commentCount: 168, author: "driver", length: 150, publishedAt: "2026-07-06T09:30:00Z" },
  { kind: "community", source: "instiz", category: "sports", tags: ["football"], title: "홀란드 팬서비스 레전드.gif", score: 340, commentCount: 54, author: "anon", length: 20, publishedAt: "2026-07-06T00:00:00Z" },

  // --- 19금(성인 인증 필요) ---
  { kind: "community", source: "dcinside", category: "humor", tags: ["meme", "story"], adult: true, title: "[19] 성인들만 아는 밈 모음 (수위주의)", score: 430, commentCount: 160, author: "anon", length: 40, publishedAt: "2026-07-06T09:40:00Z" },
  { kind: "community", source: "theqoo", category: "life", tags: ["advice", "story"], adult: true, title: "[19] 부부만 아는 현실 연애 상담 모음", score: 380, commentCount: 210, author: "anon", length: 260, publishedAt: "2026-07-06T06:00:00Z" },
  { kind: "news", source: "entnews", category: "culture", tags: ["movies"], adult: true, title: "[19] 청소년 관람불가 화제작 개봉 첫날 반응", score: 250, commentCount: 74, author: "editor", length: 420, publishedAt: "2026-07-05T21:10:00Z" },
  { kind: "community", source: "82cook", category: "life", tags: ["advice"], adult: true, title: "[19] 남편에게 말 못한 고민 (성인 게시판)", score: 300, commentCount: 188, author: "anon", length: 300, publishedAt: "2026-07-06T03:50:00Z" }
];
