package kr.ansim.scan

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.abs

// 쇼핑몰 앱 위, 화면 오른쪽 가장자리의 작은 점수 탭 + 누르면 열리는 상세 패널.
//
// 접근성 서비스 창(TYPE_ACCESSIBILITY_OVERLAY)으로 그려서 '다른 앱 위에 그리기'
// 권한 없이 뜬다. 탭은 위아래로 끌어 옮길 수 있고(몰 버튼을 가리지 않게) 위치는 기억한다.
// 패널은 바깥을 누르면 닫힌다 — 쇼핑을 막지 않는 게 원칙.
//
// 웹 확장(extension/ansim/content.js)의 탭·패널과 같은 모양·문구를 쓴다.

class FloatingTab(
    private val service: AccessibilityService,
    private val onOpenUrl: (String) -> Unit
) {
    private val wm = service.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val density = service.resources.displayMetrics.density
    private fun dp(v: Int) = (v * density).toInt()

    private val bgColor = Color.parseColor("#111416")
    private val textColor = Color.parseColor("#F2F3F4")
    private val mutedColor = Color.parseColor("#9AA1A8")
    private fun toneColor(tone: String) = Color.parseColor(
        when (tone) {
            "green" -> "#34C77B"
            "yellow" -> "#F2B632"
            "red" -> "#FF5A52"
            else -> "#8A9198"
        }
    )

    private val small = label("안심", 10f, mutedColor)
    private val scoreView = label("…", 21f, textColor, bold = true)
    private val verdictView = label("확인 중", 10.5f, mutedColor, bold = true)
    private val tabView = LinearLayout(service).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setPadding(dp(8), dp(8), dp(4), dp(9))
        addView(small)
        addView(scoreView)
        addView(verdictView)
    }
    private val tabParams = WindowManager.LayoutParams(
        dp(58), ViewGroup.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
        PixelFormat.TRANSLUCENT
    ).apply {
        gravity = Gravity.END or Gravity.TOP
        y = Store.tabY(service, dp(260))
    }

    private var tabShown = false
    private var panel: View? = null
    private var result: AnalyzeResult? = null

    init {
        paintTab("gray")
        attachDrag()
    }

    // ── 상태
    fun showWaiting() {
        result = null
        setTab("?", "원재료", "gray")
        ensureTab()
    }

    fun showLoading() {
        setTab("…", "확인 중", "gray")
        ensureTab()
    }

    fun show(r: AnalyzeResult) {
        result = r
        if (!r.known) return showWaiting()
        val shown = if (r.blocked) "–" else r.score.toString()
        setTab(shown, r.verdict, r.tone)
        ensureTab()
        if (r.blocked || r.verdictCode == "avoid") nudge()
        panel?.let { closePanel(); openPanel() }   // 패널이 열려 있으면 새 결과로
    }

    fun hide() {
        closePanel()
        if (tabShown) {
            runCatching { wm.removeView(tabView) }
            tabShown = false
        }
    }

    // ── 탭
    private fun ensureTab() {
        if (tabShown) return
        runCatching { wm.addView(tabView, tabParams) }.onSuccess { tabShown = true }
    }

    private fun setTab(score: String, verdict: String, tone: String) {
        val c = toneColor(tone)
        scoreView.text = score
        scoreView.setTextColor(if (tone == "gray") textColor else c)
        verdictView.text = verdict
        verdictView.setTextColor(if (tone == "gray") mutedColor else c)
        paintTab(tone)
    }

    private fun paintTab(tone: String) {
        tabView.background = GradientDrawable().apply {
            setColor(bgColor)
            cornerRadii = floatArrayOf(dp(14).toFloat(), dp(14).toFloat(), 0f, 0f, 0f, 0f, dp(14).toFloat(), dp(14).toFloat())
            setStroke(dp(2), toneColor(tone))
        }
        tabView.elevation = dp(6).toFloat()
    }

    private fun nudge() {
        tabView.animate().translationX(-dp(6).toFloat()).setDuration(160).withEndAction {
            tabView.animate().translationX(0f).setDuration(220).start()
        }.start()
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun attachDrag() {
        var downY = 0f
        var startY = 0
        var moved = false
        tabView.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downY = e.rawY; startY = tabParams.y; moved = false; true }
                MotionEvent.ACTION_MOVE -> {
                    val dy = (e.rawY - downY).toInt()
                    if (abs(dy) > dp(6)) moved = true
                    if (moved && tabShown) {
                        tabParams.y = (startY + dy).coerceAtLeast(0)
                        wm.updateViewLayout(tabView, tabParams)
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (moved) Store.setTabY(service, tabParams.y) else openPanel()
                    true
                }
                else -> false
            }
        }
    }

    // ── 패널
    private fun openPanel() {
        if (panel != null) return
        val content = LinearLayout(service).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(28))
        }
        val top = LinearLayout(service).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(label("안심스캔", 12.5f, mutedColor), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(label("×", 22f, mutedColor).apply { setPadding(dp(8), 0, dp(4), 0); setOnClickListener { closePanel() } })
        }
        content.addView(top)
        val r = result
        if (r == null || !r.known) {
            content.addView(label("원재료 정보를 찾는 중이에요", 15f, textColor, bold = true).apply { setPadding(0, dp(12), 0, dp(6)) })
            content.addView(label("상품정보(필수 표기정보)를 펼치면 바로 점수가 나와요. 한 번 읽힌 상품은 다음부터 상품명만으로 점수가 떠요.", 13f, mutedColor))
        } else {
            fillResult(content, r)
        }
        val scroll = ScrollView(service).apply {
            addView(content)
            background = GradientDrawable().apply { setColor(bgColor) }
            elevation = dp(10).toFloat()
        }
        val metrics = service.resources.displayMetrics
        val params = WindowManager.LayoutParams(
            minOf(dp(380), (metrics.widthPixels * 0.9).toInt()), ViewGroup.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.END or Gravity.TOP }
        // 바깥을 누르면 닫는다
        scroll.setOnTouchListener { _, e -> if (e.actionMasked == MotionEvent.ACTION_OUTSIDE) { closePanel(); true } else false }
        runCatching { wm.addView(scroll, params) }.onSuccess { panel = scroll }
    }

    fun closePanel() {
        panel?.let { runCatching { wm.removeView(it) } }
        panel = null
    }

    private fun fillResult(c: LinearLayout, r: AnalyzeResult) {
        val tone = toneColor(r.tone)
        c.addView(label(r.verdict, 30f, tone, bold = true).apply { setPadding(0, dp(6), 0, 0) })
        c.addView(label(if (r.blocked) "–" else "${r.score}", 44f, tone, bold = true))
        if (r.blocked && r.score != null) c.addView(label("아이에게 맞지 않는 성분 포함 · 일반 점수 ${r.score}", 12.5f, mutedColor))
        c.addView(label(r.productName, 12.5f, mutedColor))
        if (r.reasons.isEmpty()) c.addView(label("걸리는 항목이 없어요", 14f, toneColor("green")).apply { setPadding(0, dp(10), 0, 0) })
        for (reason in r.reasons) {
            val title = reason.title + (reason.evidence?.let { "  · 근거 $it" } ?: "")
            c.addView(label(title, 14f, if (reason.block) toneColor("red") else textColor, bold = true).apply { setPadding(0, dp(10), 0, 0) })
            c.addView(label(reason.detail, 12.5f, mutedColor))
        }
        if (r.highlights.isNotEmpty()) c.addView(label(r.highlights.joinToString(" · "), 12.5f, toneColor("green")).apply { setPadding(0, dp(8), 0, 0) })
        for (n in r.notes) c.addView(label("• $n", 12.5f, mutedColor).apply { setPadding(0, dp(6), 0, 0) })

        val heading = when {
            r.alternatives.isEmpty() -> "대체품"
            r.alternativesAreGood -> "${r.alternatives.size}개 더 안전한 선택"
            else -> "${r.alternatives.size}개 그나마 나은 선택"
        }
        c.addView(label(heading, 15f, textColor, bold = true).apply { setPadding(0, dp(18), 0, dp(4)) })
        if (r.alternatives.isEmpty()) {
            c.addView(label(if (r.verdictCode == "good") "이미 좋은 선택이에요." else "같은 종류의 대체품을 아직 찾지 못했어요.", 12.5f, mutedColor))
        }
        for (a in r.alternatives) {
            val card = LinearLayout(service).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(11), dp(10), dp(11), dp(10))
                background = GradientDrawable().apply { setColor(Color.parseColor("#1B1E21")); cornerRadius = dp(12).toFloat() }
            }
            card.addView(label("${a.name}  ${a.score}점" + if (a.sample) "  (가상 예시)" else "", 14f, textColor, bold = true))
            for (i in a.improvements) card.addView(label("• $i", 13f, Color.parseColor("#C4C9CE")))
            a.links.take(2).forEachIndexed { idx, link ->
                card.addView(Button(service).apply {
                    text = "${link.label}에서 ${if (link.direct) "보기" else "찾기"}"
                    isAllCaps = false
                    setTextColor(if (idx == 0) Color.parseColor("#06210F") else textColor)
                    background = GradientDrawable().apply {
                        setColor(Color.parseColor(if (idx == 0) "#34C77B" else "#2A2E32")); cornerRadius = dp(8).toFloat()
                    }
                    setOnClickListener { closePanel(); onOpenUrl(link.url) }
                }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(40)).apply { topMargin = dp(6) })
            }
            c.addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        }
        c.addView(label("의학적 진단이 아니며 점수와 대체품 순위는 광고·제휴와 무관합니다.", 11.5f, Color.parseColor("#6B7279")).apply { setPadding(0, dp(18), 0, 0) })
    }

    private fun label(s: String, sp: Float, color: Int, bold: Boolean = false) = TextView(service).apply {
        text = s
        textSize = sp
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.START
    }
}
