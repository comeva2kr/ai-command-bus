package kr.ansim.scan

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

// 앱 첫 화면 — 오프라인과 온라인을 한 앱에서.
//
//   위: 쇼핑앱 플로팅 탭 상태 + 켜기 버튼(접근성 설정으로 안내, 그 전에 무엇을 읽는지 고지)
//   아래: 매장용 스캐너(서버의 PWA를 WebView로) — 바코드 스캔, 라벨 사진, 결과·대체품
//
// 아이 정보는 PWA 화면에서 입력하고, window.AnsimNative 브리지로 기기에 저장해
// 쇼핑앱 위 탭(MallWatcherService)도 같은 정보를 쓴다.

class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var status: TextView
    private lateinit var enableButton: Button
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingCamera: PermissionRequest? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dark = Color.parseColor("#0D0F10")
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(dark)
        }

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(10), dp(12), dp(10))
            setBackgroundColor(Color.parseColor("#17191B"))
        }
        status = TextView(this).apply { setTextColor(Color.parseColor("#C4C9CE")); textSize = 13f }
        enableButton = Button(this).apply {
            isAllCaps = false
            setOnClickListener { explainAndOpenAccessibility() }
            setOnLongClickListener { editServer(); true }   // 개발용: 서버 주소 바꾸기
        }
        bar.addView(status, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(enableButton)
        root.addView(bar)

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            addJavascriptInterface(Bridge(), "AnsimNative")
            webViewClient = object : WebViewClient() {
                // 우리 서버 밖 링크(대체품 구매 등)는 WebView에서 열지 않고 쇼핑몰 앱·브라우저로 넘긴다.
                // 브리지(AnsimNative)가 남의 페이지에 노출되지 않게 하는 효과도 있다.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (sameOrigin(request.url)) return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    if (!sameOrigin(request.origin) || PermissionRequest.RESOURCE_VIDEO_CAPTURE !in request.resources) {
                        request.deny()
                        return
                    }
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                    } else {
                        pendingCamera = request
                        requestPermissions(arrayOf(Manifest.permission.CAMERA), REQ_CAMERA)
                    }
                }

                override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    return runCatching { startActivityForResult(params.createIntent(), REQ_FILE) }
                        .map { true }
                        .getOrElse { fileCallback = null; false }
                }
            }
        }
        root.addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        web.loadUrl(Store.server(this))
    }

    override fun onResume() {
        super.onResume()
        val on = accessibilityEnabled()
        status.text = if (on) "쇼핑앱 플로팅 탭 켜짐 · 쿠팡·네이버·컬리·SSG·11번가" else "쇼핑앱 위에 점수 탭을 띄우려면 켜 주세요"
        enableButton.text = if (on) "설정" else "켜기"
    }

    private fun sameOrigin(uri: Uri): Boolean {
        val server = Uri.parse(Store.server(this))
        return uri.scheme == server.scheme && uri.host == server.host && uri.port == server.port
    }

    private fun accessibilityEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        return enabled.split(':').any { it.startsWith("$packageName/") }
    }

    // 구글 플레이 접근성 API 정책의 '명확한 고지': 켜기 전에 무엇을 읽고 무엇을 안 읽는지 알린다
    private fun explainAndOpenAccessibility() {
        AlertDialog.Builder(this)
            .setTitle("쇼핑앱 위에 점수 탭 띄우기")
            .setMessage(
                "안심스캔은 접근성 기능으로 쿠팡·네이버·컬리·SSG·11번가 앱(그리고 크롬·삼성 인터넷의 해당 쇼핑몰 페이지)의 " +
                    "상품명과 원재료·영양성분 표시 글자만 읽어 점수 탭을 띄웁니다.\n\n" +
                    "• 다른 앱의 화면 내용은 읽지 않습니다.\n" +
                    "• 로그인·결제·주소 정보는 수집하지 않습니다.\n" +
                    "• 읽은 상품 정보는 점수 계산을 위해 안심스캔 서버로 보내며, 아이 이름은 보내지 않습니다.\n\n" +
                    "다음 화면에서 '안심스캔 쇼핑 탭'을 켜 주세요."
            )
            .setPositiveButton("동의하고 설정 열기") { _, _ -> startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
            .setNegativeButton("나중에", null)
            .show()
    }

    private fun editServer() {
        val input = EditText(this).apply { setText(Store.server(this@MainActivity)) }
        AlertDialog.Builder(this)
            .setTitle("서버 주소")
            .setView(input)
            .setPositiveButton("저장") { _, _ ->
                val url = input.text.toString()
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    Store.setServer(this, url)
                    web.loadUrl(Store.server(this))
                }
            }
            .setNegativeButton("취소", null)
            .show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        if (requestCode != REQ_CAMERA) return
        val req = pendingCamera ?: return
        pendingCamera = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) req.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
        else req.deny()
    }

    @Deprecated("플랫폼 Activity만 쓰므로(무의존성) ActivityResult API 대신 사용")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQ_FILE) return super.onActivityResult(requestCode, resultCode, data)
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
        fileCallback = null
    }

    @Deprecated("뒤로 가기: WebView 기록 먼저")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    // PWA(src/ansim/public/app.js)가 쓰는 브리지
    inner class Bridge {
        @JavascriptInterface
        fun getProfile(): String? = if (Store.hasProfile(this@MainActivity)) Store.profileJson(this@MainActivity) else null

        @JavascriptInterface
        fun setProfile(json: String) {
            Store.setProfileJson(this@MainActivity, json)
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        private const val REQ_CAMERA = 1
        private const val REQ_FILE = 2
    }
}
