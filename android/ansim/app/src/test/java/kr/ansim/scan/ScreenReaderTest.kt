package kr.ansim.scan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenReaderTest {
    // 쿠팡 앱 상품 화면을 접근성 트리 순서로 읽었을 때 나올 법한 줄들
    private val productScreen = listOf(
        "뒤로", "검색", "장바구니",
        "로켓배송",
        "꼬마 비엔나 소시지 1kg",
        "4.5", "리뷰 1,234",
        "9,900원",
        "필수 표기정보",
        "식품의 유형", "소시지",
        "원재료명 및 함량", "돼지고기(국산) 72%, 정제수, 아질산나트륨(발색제)",
        "영양성분", "1회 섭취참고량 50g당 140kcal 나트륨 520mg",
        "알레르기 유발물질", "대두, 돼지고기 함유",
        "장바구니 담기", "바로구매"
    )

    @Test
    fun readsTitleAndNoticeRows() {
        val s = ScreenReader.read(productScreen)
        assertEquals("꼬마 비엔나 소시지 1kg", s.title)
        assertTrue(s.productPage)
        assertTrue(s.hasIngredients)
        assertEquals(
            listOf(
                "식품의 유형" to "소시지",
                "원재료명 및 함량" to "돼지고기(국산) 72%, 정제수, 아질산나트륨(발색제)",
                "영양성분" to "1회 섭취참고량 50g당 140kcal 나트륨 520mg",
                "알레르기 유발물질" to "대두, 돼지고기 함유"
            ),
            s.rows
        )
    }

    @Test
    fun collapsedNoticeStillAProductPage() {
        // 고시표가 접혀 있으면 상품명만 — 서버가 기억해 둔 원재료로 판정한다
        val s = ScreenReader.read(listOf("뒤로", "꼬마 비엔나 소시지 1kg", "9,900원", "상품정보 더보기", "장바구니 담기", "바로구매"))
        assertEquals("꼬마 비엔나 소시지 1kg", s.title)
        assertTrue(s.productPage)
        assertFalse(s.hasIngredients)
    }

    @Test
    fun homeScreenIsNotAProductPage() {
        val s = ScreenReader.read(listOf("쿠팡", "검색", "오늘의 발견 모음전", "로켓프레시 특가", "카테고리"))
        assertFalse(s.productPage)
    }

    @Test
    fun inlineKeyValueAndEmptyValues() {
        val rows = ScreenReader.rows(listOf("원재료명 : 정제수, 볶은보리", "영양성분", "알레르기 유발물질", "해당 없음"))
        // '영양성분' 다음 줄이 또 다른 항목명이라 값이 없는 것으로 본다
        assertEquals(listOf("원재료명" to "정제수, 볶은보리", "알레르기 유발물질" to "해당 없음"), rows)
    }

    @Test
    fun noTitleFromButtonsAndPrices() {
        assertNull(ScreenReader.guessTitle(listOf("9,900원", "20% 할인 쿠폰", "무료배송", "리뷰 쓰기")))
    }
}
