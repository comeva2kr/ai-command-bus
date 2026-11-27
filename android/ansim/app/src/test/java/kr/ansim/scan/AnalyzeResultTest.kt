package kr.ansim.scan

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// 서버(src/ansim/server.js) 실제 응답을 앱이 그대로 읽는지 — 둘 사이 계약 테스트.
// analyze-response.json은 `npm run ansim`에 POST /api/ansim/analyze 한 결과를 저장한 것이다.
class AnalyzeResultTest {
    private fun fixture(): JSONObject =
        JSONObject(javaClass.classLoader!!.getResource("analyze-response.json")!!.readText())

    @Test
    fun parsesRealServerResponse() {
        val r = AnalyzeResult.parse(fixture())
        assertEquals("분홍 어육소시지", r.productName)
        assertEquals(45, r.score)
        assertEquals("비추천", r.verdict)
        assertEquals("avoid", r.verdictCode)
        assertEquals("red", r.tone)
        assertFalse(r.blocked)
        assertTrue(r.reasons.first().title.startsWith("적색3호"))
        assertEquals("A", r.reasons.first().evidence)
        assertTrue(r.notes.any { it.contains("MSG") })
        assertTrue(r.alternativesAreGood)
        val alt = r.alternatives.first()
        assertTrue(alt.sample)
        assertTrue(alt.improvements.contains("아질산나트륨(발색제) 없음"))
        assertEquals("쿠팡", alt.links.first().label)
        assertTrue(alt.links.first().url.startsWith("https://www.coupang.com/"))
    }

    @Test
    fun unknownAndUnsafeLinks() {
        val unknown = AnalyzeResult.parse(JSONObject("""{"analysis":{"score":null,"verdict":{"code":"unknown","label":"정보 부족","tone":"gray"}}}"""))
        assertFalse(unknown.known)
        val withBadLink = AnalyzeResult.parse(JSONObject(
            """{"analysis":{"score":80,"verdict":{"code":"good","label":"추천","tone":"green"}},
               "alternatives":[{"tier":"good","product":{"name":"x"},"analysis":{"score":90},"improvements":[],
               "links":[{"label":"악성","url":"javascript:alert(1)"},{"label":"쿠팡","url":"https://www.coupang.com/np/search?q=x"}]}]}"""
        ))
        assertEquals(listOf("쿠팡"), withBadLink.alternatives.first().links.map { it.label })
    }
}
