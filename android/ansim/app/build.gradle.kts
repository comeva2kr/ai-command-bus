// 안심스캔 안드로이드 앱 — 외부 라이브러리 없이 플랫폼 API만 쓴다
// (저장소 전체의 무의존성 원칙과 같다). 화면도 XML 레이아웃 없이 코드로 만든다.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "kr.ansim.scan"
    compileSdk = 35

    defaultConfig {
        applicationId = "kr.ansim.scan"
        minSdk = 26          // TYPE_ACCESSIBILITY_OVERLAY 위 플로팅 탭, 적응형 아이콘
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    // 로컬 단위 테스트의 android.jar는 org.json이 빈 껍데기라 실제 구현을 넣는다
    testImplementation("org.json:json:20240303")
}
