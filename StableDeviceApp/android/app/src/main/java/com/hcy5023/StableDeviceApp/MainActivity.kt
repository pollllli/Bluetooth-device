package com.hcy5023.StableDeviceApp

import android.content.Intent
import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.bridge.ReactContext

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }

  /**
   * 修复: App 已在后台运行时 (singleTask 模式), 微信/QQ 分享文件触发新 Intent.
   * 默认 ReactActivity 不重发 Linking 事件给 JS 层, App.tsx 里的
   * Linking.addEventListener('url', ...) 永远收不到 → "选了用 App 打开但没反应"
   *
   * 修法: 显式 override onNewIntent, 把 Intent 通过 ReactContext 发给 JS,
   * 这样 React Native 的 RCTLinkingManager 就能把 url 事件派发出去。
   */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    // Android 文档要求把新 intent 设为 activity 的主 intent, 不然下次 getIntent() 还是老的
    setIntent(intent)
    try {
      // 把新 Intent 透传给 React Native, JS 层的 Linking 监听器就会收到 url 事件
      // 冷启动场景 RN 还没 ready, reactInstanceManager.onNewIntent 内部会等 ready 后派发
      reactInstanceManager?.onNewIntent(intent)
    } catch (e: Throwable) {
      // 任何异常都不应崩溃, 静默吞掉
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
