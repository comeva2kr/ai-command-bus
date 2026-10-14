package kr.ansim.scan

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.concurrent.Executors

// 백그라운드 상주 — 지금 쓰는 쇼핑몰 앱을 알아보고 그 위에 점수 탭을 띄운다.
//
// 사용자가 설정 > 접근성에서 켜면 시스템이 이 서비스를 계속 살려 둔다(별도 포그라운드
// 서비스·알림 불필요). 하는 일:
//   1. 화면 전환 이벤트의 패키지 이름으로 쇼핑몰 앱인지 본다. 브라우저면 주소창 호스트로.
//      쇼핑몰이 아니면 탭을 숨기고 끝 — 그 앱의 화면 내용은 읽지 않는다.
//   2. 쇼핑몰이면 화면 글자를 훑어 상품명과 고시표(원재료·영양·알레르기)를 뽑는다(ScreenReader).
//   3. 상품 화면이면 서버에 판정을 묻고 탭에 점수를 띄운다. 같은 화면이면 다시 묻지 않는다.
//
// 이벤트는 스크롤 한 번에도 수십 개 온다. 0.8초 모아서 한 번만 읽는다.

class MallWatcherService : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private lateinit var tab: FloatingTab

    private var mall: Mall? = null
    private var scanQueued = false
    private var lastKey = ""
    private var requestSeq = 0

    override fun onServiceConnected() {
        tab = FloatingTab(this) { url -> openUrl(url) }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (!::tab.isInitialized) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg == packageName || pkg in Malls.IGNORED) return

        val detected = Malls.forPackage(pkg) ?: if (Malls.isBrowser(pkg)) browserMall(pkg) else null
        if (detected == null) {
            // 쇼핑몰을 떠났다 — 탭을 숨긴다. 내용은 읽지 않는다.
            if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || mall != null) leaveMall()
            return
        }
        mall = detected
        queueScan()
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (::tab.isInitialized) tab.hide()
        io.shutdownNow()
        super.onDestroy()
    }

    private fun leaveMall() {
        mall = null
        lastKey = ""
        requestSeq++          // 날아가는 중인 응답은 버린다
        tab.hide()
    }

    private fun browserMall(pkg: String): Mall? {
        val id = Malls.BROWSER_URL_BAR[pkg] ?: return null
        val root = rootInActiveWindow ?: return null
        val url = root.findAccessibilityNodeInfosByViewId(id).firstOrNull()?.text?.toString() ?: return null
        return Malls.fromUrl(url)
    }

    private fun queueScan() {
        if (scanQueued) return
        scanQueued = true
        main.postDelayed({ scanQueued = false; scan() }, 800)
    }

    private fun scan() {
        val m = mall ?: return
        val root = rootInActiveWindow ?: return
        if (root.packageName?.toString() == packageName) return   // 우리 패널을 읽지 않는다
        val titleById = ScreenReader.TITLE_VIEW_IDS[root.packageName?.toString()]
            ?.firstNotNullOfOrNull { id -> root.findAccessibilityNodeInfosByViewId(id).firstOrNull()?.text?.toString() }
        val screen = ScreenReader.read(collectLines(root), titleById)

        if (!screen.productPage || (screen.title == null && screen.rows.isEmpty())) {
            // 검색 결과·홈 같은 상품이 아닌 화면
            lastKey = ""
            tab.hide()
            return
        }
        val profile = Store.profileJson(this)
        val key = "${m.id}|${screen.title}|${screen.rows.hashCode()}|$profile"
        if (key == lastKey) return
        lastKey = key

        tab.showLoading()
        val seq = ++requestSeq
        val api = AnsimApi(Store.server(this))
        io.execute {
            val result = runCatching { api.analyze(m, screen, profile) }
            main.post {
                if (seq != requestSeq) return@post
                result.onSuccess { tab.show(it) }.onFailure {
                    lastKey = ""        // 실패하면 다음 이벤트에 다시 시도
                    tab.showWaiting()
                }
            }
        }
    }

    // 접근성 트리를 위에서부터(화면 순서대로) 훑어 글자 줄을 모은다. 큰 화면에서
    // 멈추지 않게 노드 수를 제한한다.
    private fun collectLines(root: AccessibilityNodeInfo): List<String> {
        val out = ArrayList<String>()
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.addLast(root)
        var visited = 0
        while (stack.isNotEmpty() && visited < MAX_NODES) {
            val node = stack.removeLast()
            visited++
            val t = node.text?.toString() ?: node.contentDescription?.toString()
            if (!t.isNullOrBlank()) out += t
            for (i in node.childCount - 1 downTo 0) node.getChild(i)?.let { stack.addLast(it) }
        }
        return out
    }

    // 대체품 링크 → 그 몰 앱이 깔려 있으면 앱 링크로 앱이 열린다
    private fun openUrl(url: String) {
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    companion object {
        private const val MAX_NODES = 2500
    }
}
