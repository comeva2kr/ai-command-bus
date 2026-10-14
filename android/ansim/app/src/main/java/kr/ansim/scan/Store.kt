package kr.ansim.scan

import android.content.Context
import org.json.JSONObject

// 기기 안 저장소 — 아이 프로필, 서버 주소, 플로팅 탭 위치.
// 아이 프로필은 앱 안 스캐너(WebView)와 쇼핑앱 위 탭이 같이 쓴다(한 번만 입력).
object Store {
    private const val PREFS = "ansim"
    // 에뮬레이터에서 PC의 `npm run ansim`. 실서비스에선 HTTPS 주소로 바꾼다.
    const val DEFAULT_SERVER = "http://10.0.2.2:4100"
    private const val DEFAULT_PROFILE = """{"name":"","age":6,"allergies":[],"concerns":[],"mall":"coupang"}"""

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun profileJson(ctx: Context): String = prefs(ctx).getString("profile", null) ?: DEFAULT_PROFILE

    fun hasProfile(ctx: Context): Boolean = prefs(ctx).contains("profile")

    // WebView에서 오는 값이라 JSON인지 확인하고 저장한다
    fun setProfileJson(ctx: Context, json: String): Boolean {
        val parsed = runCatching { JSONObject(json) }.getOrNull() ?: return false
        prefs(ctx).edit().putString("profile", parsed.toString()).apply()
        return true
    }

    fun server(ctx: Context): String = prefs(ctx).getString("server", null) ?: DEFAULT_SERVER

    fun setServer(ctx: Context, url: String) {
        prefs(ctx).edit().putString("server", url.trim().trimEnd('/')).apply()
    }

    fun tabY(ctx: Context, default: Int): Int = prefs(ctx).getInt("tabY", default)

    fun setTabY(ctx: Context, y: Int) {
        prefs(ctx).edit().putInt("tabY", y).apply()
    }
}
