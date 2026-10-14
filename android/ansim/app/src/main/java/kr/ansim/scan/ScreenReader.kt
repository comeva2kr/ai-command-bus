package kr.ansim.scan

// 쇼핑몰 앱 화면 글자 → 상품명 + 상품정보제공고시 키-값.
//
// 접근성 트리를 위에서부터 훑어 얻은 글자 줄(lines)만 받는다. 안드로이드 API를
// 쓰지 않는 순수 코드라 JVM 단위 테스트로 검증한다.
//
// 고시표는 웹뷰든 네이티브든 "원재료명 및 함량" 다음 줄에 값이 오는 모양으로
// 읽힌다. "원재료명 : 돼지고기, …"처럼 한 줄에 붙어 오는 경우도 있다.
// 판정은 하지 않는다 — 키-값만 서버(src/ansim/core)에 넘긴다.
//
// 상품명은 앱마다 view id가 달라 지금은 경험칙으로 고른다(첫 화면 위쪽의, 가격·버튼
// 문구가 아닌, 띄어쓰기 있는 한글 줄). 실기기에서 몰별 view id를 확인하면
// TITLE_VIEW_IDS로 정확히 잡을 수 있다.

data class Screen(val title: String?, val rows: List<Pair<String, String>>, val productPage: Boolean = rows.isNotEmpty()) {
    val hasIngredients: Boolean get() = rows.any { INGREDIENT_KEY.containsMatchIn(it.first) }

    companion object {
        val INGREDIENT_KEY = Regex("원재료")
    }
}

object ScreenReader {
    // 몰 앱별 상품명 view id (실기기에서 채운다). 있으면 경험칙보다 먼저 쓴다.
    val TITLE_VIEW_IDS: Map<String, List<String>> = emptyMap()

    private val KEY = Regex("원재료|영양\\s*(성분|정보)|알레르기|알러지|식품\\s*의?\\s*유형|제품\\s*유형|^(제품명|품명|상품명)$")
    private val INLINE = Regex("^\\s*([^:：]{2,20}?)\\s*[:：]\\s*(.+)$")
    private val HANGUL = Regex("[가-힣]")
    private val NOT_TITLE = Regex(
        "\\d[\\d,]*\\s*원|%|리뷰|구매|장바구니|배송|쿠폰|로그인|검색|할인|적립|판매자|문의|옵션|수량|선택|공유|찜|" +
            "홈|카테고리|도착|무료|더보기|닫기|뒤로|알림|메뉴|추천|광고|이벤트|혜택|멤버십|와우|로켓"
    )

    // 상품 상세 화면 표시 — 구매 버튼이나 고시표 제목이 보이면 상품 화면으로 본다.
    // 홈·검색 결과에서까지 탭을 띄우면 거슬리기만 한다.
    private val PRODUCT_PAGE = Regex("^(구매하기|바로\\s*구매|바로구매하기|장바구니\\s*담기|장바구니|선물하기)$|필수\\s*표기\\s*정보|상품\\s*정보\\s*제공\\s*고시")

    private const val TITLE_SCAN_LINES = 40
    private const val KEY_MAX_LEN = 20

    fun read(lines: List<String>, titleFromViewId: String? = null): Screen {
        val clean = lines.map { it.replace(Regex("\\s+"), " ").trim() }.filter { it.isNotEmpty() }
        val rows = rows(clean)
        val productPage = rows.isNotEmpty() || clean.any { PRODUCT_PAGE.containsMatchIn(it) }
        return Screen(titleFromViewId ?: guessTitle(clean), rows, productPage)
    }

    fun guessTitle(lines: List<String>): String? =
        lines.take(TITLE_SCAN_LINES).firstOrNull { line ->
            line.length in 6..120 &&
                HANGUL.containsMatchIn(line) &&
                line.contains(' ') &&
                !NOT_TITLE.containsMatchIn(line) &&
                !KEY.containsMatchIn(line)
        }

    fun rows(lines: List<String>): List<Pair<String, String>> {
        val out = mutableListOf<Pair<String, String>>()
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val inline = INLINE.find(line)
            if (inline != null && KEY.containsMatchIn(inline.groupValues[1])) {
                out += inline.groupValues[1].trim() to inline.groupValues[2].trim()
            } else if (line.length <= KEY_MAX_LEN && KEY.containsMatchIn(line) && i + 1 < lines.size) {
                val next = lines[i + 1]
                // 다음 줄이 또 다른 항목명이면 값이 비어 있는 것 — 짝짓지 않는다
                if (!(next.length <= KEY_MAX_LEN && KEY.containsMatchIn(next))) {
                    out += line to next
                    i++
                }
            }
            i++
        }
        return out
    }
}
