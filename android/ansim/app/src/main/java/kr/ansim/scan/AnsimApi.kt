package kr.ansim.scan

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

// 서버 POST /api/ansim/analyze 호출. 판정은 서버의 코어(src/ansim/core)가 한다 —
// 웹·확장·앱이 같은 제품에 같은 점수를 내야 해서 판정 코드를 여기 다시 쓰지 않는다.
//
// 보내는 것: 몰 id, 화면에서 읽은 상품명과 고시표 키-값, 판정용 프로필(이름 제외).
// 고시표가 접혀 있어 원재료가 안 보이면 상품명만 간다 — 서버는 전에 누군가 읽어 둔
// 같은 상품의 원재료로 판정한다(src/ansim/server.js의 listing 기억).

data class Reason(val title: String, val detail: String, val evidence: String?, val block: Boolean)
data class BuyLink(val label: String, val url: String, val direct: Boolean)
data class Alternative(val name: String, val score: Int, val improvements: List<String>, val links: List<BuyLink>, val sample: Boolean)

data class AnalyzeResult(
    val productName: String,
    val score: Int?,
    val verdict: String,
    val verdictCode: String,
    val tone: String,
    val reasons: List<Reason>,
    val notes: List<String>,
    val highlights: List<String>,
    val alternatives: List<Alternative>,
    val alternativesAreGood: Boolean
) {
    val blocked: Boolean get() = verdictCode == "block"
    val known: Boolean get() = score != null

    companion object {
        private fun JSONArray?.strings(): List<String> =
            if (this == null) emptyList() else (0 until length()).map { optString(it) }

        private fun JSONArray?.objects(): List<JSONObject> =
            if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

        fun parse(json: JSONObject): AnalyzeResult {
            val analysis = json.optJSONObject("analysis") ?: JSONObject()
            val verdict = analysis.optJSONObject("verdict") ?: JSONObject()
            val alternatives = json.optJSONArray("alternatives").objects()
            return AnalyzeResult(
                productName = json.optJSONObject("product")?.optString("name").orEmpty(),
                score = if (analysis.isNull("score") || !analysis.has("score")) null else analysis.optInt("score"),
                verdict = verdict.optString("label", "정보 부족"),
                verdictCode = verdict.optString("code", "unknown"),
                tone = verdict.optString("tone", "gray"),
                reasons = analysis.optJSONArray("reasons").objects().map {
                    Reason(
                        title = it.optString("title"),
                        detail = it.optString("detail"),
                        evidence = it.optString("evidence").takeIf { e -> e.isNotEmpty() && e != "info" },
                        block = it.optBoolean("block")
                    )
                },
                notes = analysis.optJSONArray("notes").strings(),
                highlights = analysis.optJSONArray("highlights").strings(),
                alternatives = alternatives.map { alt ->
                    val p = alt.optJSONObject("product") ?: JSONObject()
                    Alternative(
                        name = p.optString("name"),
                        score = alt.optJSONObject("analysis")?.optInt("score") ?: 0,
                        improvements = alt.optJSONArray("improvements").strings(),
                        links = alt.optJSONArray("links").objects()
                            .filter { it.optString("url").startsWith("https://") }   // http(s) 외 스킴은 열지 않는다
                            .map { BuyLink(it.optString("label"), it.optString("url"), it.optString("kind") == "direct") },
                        sample = p.optBoolean("sample")
                    )
                },
                alternativesAreGood = alternatives.firstOrNull()?.optString("tier") == "good"
            )
        }
    }
}

class AnsimApi(private val baseUrl: String) {
    fun analyze(mall: Mall, screen: Screen, profileJson: String): AnalyzeResult {
        val profile = runCatching { JSONObject(profileJson) }.getOrElse { JSONObject() }.put("name", "")
        val rows = JSONArray()
        for ((k, v) in screen.rows) rows.put(JSONArray().put(k).put(v))
        val body = JSONObject()
            .put("mall", mall.id)
            .put("profile", profile)
            .put("notice", JSONObject().put("title", screen.title.orEmpty()).put("url", "").put("rows", rows))

        val conn = URL("${baseUrl.trimEnd('/')}/api/ansim/analyze").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 5000
            conn.readTimeout = 10000
            conn.doOutput = true
            conn.setRequestProperty("content-type", "application/json; charset=utf-8")
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            if (code !in 200..299) throw IOException("http $code")
            val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            return AnalyzeResult.parse(JSONObject(text))
        } finally {
            conn.disconnect()
        }
    }
}
