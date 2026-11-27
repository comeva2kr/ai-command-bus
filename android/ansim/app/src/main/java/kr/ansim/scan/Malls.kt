package kr.ansim.scan

// 지금 화면에 떠 있는 쇼핑몰 앱 알아보기.
//
// 1) 쇼핑몰 전용 앱: 패키지 이름으로 바로 안다.
// 2) 브라우저(크롬·삼성 인터넷): 주소창 글자에서 호스트를 읽어 판단한다 —
//    웹 확장을 못 쓰는 모바일 브라우저도 이 길로 덮는다.
// 몰 id는 서버·웹 코어(src/ansim/core/malls.js)와 같은 값을 쓴다.
//
// ⚠ 패키지 이름과 주소창 view id는 플레이스토어·실기기에서 확인이 필요하다
//    (docs/ansim-scan.md 검증 목록). 틀리면 이 파일만 고치면 된다.

data class Mall(val id: String, val label: String)

object Malls {
    val COUPANG = Mall("coupang", "쿠팡")
    val NAVER = Mall("naver", "네이버쇼핑")
    val KURLY = Mall("kurly", "컬리")
    val SSG = Mall("ssg", "SSG")
    val ELEVENST = Mall("11st", "11번가")

    private val APPS = mapOf(
        "com.coupang.mobile" to COUPANG,
        "com.nhn.android.search" to NAVER,   // 네이버 앱 — 쇼핑·스마트스토어가 이 안에서 열린다
        "com.dbs.kurly.m2" to KURLY,
        "kr.co.ssg" to SSG,
        "com.elevenst" to ELEVENST
    )

    // 브라우저 패키지 → 주소창 view id
    val BROWSER_URL_BAR = mapOf(
        "com.android.chrome" to "com.android.chrome:id/url_bar",
        "com.sec.android.app.sbrowser" to "com.sec.android.app.sbrowser:id/location_bar_edit_text"
    )

    // 이 패키지들의 이벤트로는 탭을 숨기지 않는다 — 알림창·키보드가 잠깐 뜰 때마다
    // 탭이 깜빡이면 안 된다
    val IGNORED = setOf(
        "com.android.systemui",
        "com.google.android.inputmethod.latin",
        "com.samsung.android.honeyboard",
        "com.sec.android.inputmethod",
        "com.navercorp.android.smartboard"
    )

    private val HOSTS = listOf(
        Regex("(^|\\.)coupang\\.com$") to COUPANG,
        Regex("(^|\\.)(smartstore|brand|shopping|search\\.shopping)\\.naver\\.com$") to NAVER,
        Regex("(^|\\.)kurly\\.com$") to KURLY,
        Regex("(^|\\.)ssg\\.com$") to SSG,
        Regex("(^|\\.)11st\\.co\\.kr$") to ELEVENST
    )

    fun forPackage(pkg: String): Mall? = APPS[pkg]

    fun isBrowser(pkg: String): Boolean = pkg in BROWSER_URL_BAR

    // 주소창은 "coupang.com/vp/…"처럼 스킴 없이 보이기도 한다
    fun hostOf(url: String): String =
        url.trim().lowercase()
            .substringAfter("://")
            .substringBefore('/')
            .substringBefore('?')
            .substringBefore(':')

    fun fromUrl(url: String): Mall? {
        val host = hostOf(url)
        if (host.isEmpty()) return null
        return HOSTS.firstOrNull { it.first.containsMatchIn(host) }?.second
    }
}
