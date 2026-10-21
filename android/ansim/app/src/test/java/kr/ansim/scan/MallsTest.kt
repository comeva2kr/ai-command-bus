package kr.ansim.scan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MallsTest {
    @Test
    fun mallAppsByPackage() {
        assertEquals("coupang", Malls.forPackage("com.coupang.mobile")?.id)
        assertEquals("naver", Malls.forPackage("com.nhn.android.search")?.id)
        assertNull(Malls.forPackage("com.kakao.talk"))
    }

    @Test
    fun browsersByAddressBar() {
        assertTrue(Malls.isBrowser("com.android.chrome"))
        assertFalse(Malls.isBrowser("com.coupang.mobile"))
        // 주소창은 스킴 없이 보이기도 한다
        assertEquals("coupang", Malls.fromUrl("m.coupang.com/vm/products/777")?.id)
        assertEquals("naver", Malls.fromUrl("https://m.smartstore.naver.com/shop/products/1")?.id)
        assertEquals("kurly", Malls.fromUrl("www.kurly.com/goods/5")?.id)
        assertEquals("11st", Malls.fromUrl("https://m.11st.co.kr/products/9")?.id)
        assertNull(Malls.fromUrl("notcoupang.com.evil.example/vp/products/1"))
        assertNull(Malls.fromUrl("news.naver.com/article/1"))
        assertNull(Malls.fromUrl(""))
    }

    @Test
    fun ids_match_web_core() {
        // src/ansim/core/malls.js의 MALL_IDS와 같아야 서버가 링크를 그 몰로 만든다
        assertEquals(
            listOf("coupang", "naver", "kurly", "ssg", "11st"),
            listOf(Malls.COUPANG, Malls.NAVER, Malls.KURLY, Malls.SSG, Malls.ELEVENST).map { it.id }
        )
    }
}
