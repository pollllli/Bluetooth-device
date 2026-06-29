import React, { useState, useEffect, useRef } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Linking,
  Alert,
  Modal,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Platform,
  NativeModules,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { File as NewFile } from 'expo-file-system';  // 新 API：支持 content:// URI（如微信分享的文件）

import AppNavigator, { navigationRef } from './src/navigation/AppNavigator';
import { UserProvider } from './src/context/UserContext';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ErrorBoundary from './src/components/ErrorBoundary';
import StorageService from './src/services/StorageService';
import { logError } from './src/utils/ErrorHandler';
import * as pendingBomImport from './src/utils/pendingBomImport';

const FETCH_TIMEOUT_MS = 30000;

const fetchWithTimeout = (uri: string, options: RequestInit = {}): Promise<Response> => {
  return Promise.race([
    fetch(uri, options),
    new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error('读取文件超时')), FETCH_TIMEOUT_MS)
    ),
  ]) as unknown as Promise<Response>;
};

/**
 * 手写 base64 编码（零依赖）
 * React Native 没有全局 Buffer / btoa，只能用查表的方式实现
 * 性能比 Buffer.from() 慢但足够用于导入流程
 *
 * @param {Uint8Array} bytes 原始字节
 * @returns {string} base64 字符串（无换行）
 */
const encodeBytesToBase64 = (bytes: Uint8Array) => {
  const CHARS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const len = bytes.length;
  let result = '';
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const b1 = bytes[i];
    const b2 = bytes[i + 1];
    const b3 = bytes[i + 2];
    result += CHARS[b1 >> 2];
    result += CHARS[((b1 & 0x03) << 4) | (b2 >> 4)];
    result += CHARS[((b2 & 0x0f) << 2) | (b3 >> 6)];
    result += CHARS[b3 & 0x3f];
  }
  if (i < len) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    result += CHARS[b1 >> 2];
    result += CHARS[((b1 & 0x03) << 4) | (b2 >> 4)];
    if (i + 1 < len) {
      result += CHARS[(b2 & 0x0f) << 2];
    } else {
      result += '=';
    }
    result += '=';
  }
  return result;
};

/**
 * 提取设备调试信息
 * 用于 BOM 文件导入失败时排查华为/鸿蒙等特殊机型问题
 */
const getDeviceDebugInfo = () => {
  const constants: any = Platform.OS === 'android' ? Platform.constants || {} : {};
  // 鸿蒙 4.x 走 AOSP 兼容层，Platform.OS = 'android'
  // 鸿蒙 NEXT 不兼容 Android 应用（装不上）
  return {
    os: Platform.OS,                                          // 'android' / 'ios'
    osVersion: Platform.Version,                              // Android API level，如 33/34
    brand: constants.Brand || 'unknown',                      // 'HUAWEI' / 'Xiaomi' / 'OPPO' / ...
    manufacturer: constants.Manufacturer || 'unknown',        // 'HUAWEI' / 'Xiaomi' / ...
    model: constants.Model || 'unknown',                      // 'Mate 60 Pro' / 'P50' ...
    fingerprint: constants.Fingerprint || '',                 // ro.build.fingerprint
    isHuawei: /huawei/i.test(`${constants.Brand || ''} ${constants.Manufacturer || ''}`),
  };
};

/**
 * 判断 URL 是否为可处理的 JSON 文件 URI
 * 微信等应用通过"打开方式"传入的 URI 格式：
 *   - content://...（Android FileProvider 提供的 content URI）
 *   - file:///...（部分系统直接传递的本地文件路径）
 *   - 也有可能以 exp+stabledeviceapp 之类的 scheme 出现（保留给 deep link）
 */
const isImportableFileUrl = (url: string) => {
  if (!url) return false;
  if (url.startsWith('content://')) return true;
  if (url.startsWith('file://')) return true;
  // 兜底：路径中包含 .json 也尝试处理
  return /\.json(\?|$)/i.test(url);
};

/**
 * 判断 URL 是否为可处理的 BOM Excel 文件 URI
 * 支持 .xlsx / .xls / .csv 格式
 */
const isImportableBomUrl = (url: string) => {
  if (!url) return false;
  if (!url.startsWith('content://') && !url.startsWith('file://')) return false;
  return /\.(xlsx|xls|csv)(\?|$)/i.test(url);
};

/**
 * 从 URI 中提取文件名（尽力而为，失败时回退为通用名称）
 * 微信等应用分享时可能附带 displayName 查询参数（带 URL 编码的原始文件名），
 * 优先从 query 中取 displayName，否则取路径最后一段
 */
const extractFileName = (url: string) => {
  try {
    // 优先尝试从 query 中取 displayName（微信 FileProvider 通常带此参数）
    const queryIndex = url.indexOf('?');
    if (queryIndex !== -1) {
      const queryString = url.substring(queryIndex + 1);
      const params = queryString.split('&');
      for (const param of params) {
        const [key, value] = param.split('=');
        if (key === 'displayName' && value) {
          return decodeURIComponent(value);
        }
      }
    }
    // 兜底：取路径最后一段
    const cleanUrl = queryIndex !== -1 ? url.substring(0, queryIndex) : url;
    const lastSegment = cleanUrl.split('/').pop() || '';
    if (lastSegment) {
      return decodeURIComponent(lastSegment);
    }
  } catch (e) {
    // 忽略解码失败
  }
  return 'imported_data.json';
};

export default function App() {
  // 待导入文件 URI（来自外部应用分享）
  const [pendingImportUri, setPendingImportUri] = useState<string | null>(null);
  // 待导入文件名（用于在弹窗中展示）
  const [pendingImportName, setPendingImportName] = useState<string>('');
  // 导入进行中状态
  const [isImporting, setIsImporting] = useState(false);
  // 待导入的 BOM Excel 文件 URI（来自微信等应用分享）
  const [pendingBomUri, setPendingBomUri] = useState<string | null>(null);
  // 待导入 BOM 文件名
  const [pendingBomName, setPendingBomName] = useState<string>('');
  // BOM 导入进行中状态
  const [isBomImporting, setIsBomImporting] = useState(false);

  /**
   * 处理从外部应用接收到的 URL（冷启动或热启动）
   * 根据文件类型路由到不同流程：
   *   - .xlsx/.xls/.csv → BOM 配单导入
   *   - .json → 数据备份导入
   * @param {string} url - 其他应用通过 Intent 传入的 URI
   */
  const handleIncomingUrl = (url: string) => {
    if (!url) return;
    console.log('[App] 收到外部应用传入的 URL:', url);

    // BOM Excel 文件优先路由到 BOM 导入流程
    if (isImportableBomUrl(url)) {
      setPendingBomName(extractFileName(url));
      setPendingBomUri(url);
      return;
    }

    if (!isImportableFileUrl(url)) {
      return;
    }

    setPendingImportName(extractFileName(url));
    setPendingImportUri(url);
  };

  // ============ 全局错误处理 - 启动时立刻注册, 防止崩溃丢错 ============
  useEffect(() => {
    const saveError = async (key: string, value: string) => {
      try {
        await AsyncStorage.setItem(key, value);
      } catch (e) {
        // ignore
      }
    };

    // 1. 全局同步错误捕获
    const originalHandler = (global as any).ErrorUtils?.getGlobalHandler?.();
    if ((global as any).ErrorUtils?.setGlobalHandler) {
      (global as any).ErrorUtils.setGlobalHandler((error: Error, isFatal: boolean) => {
        console.error('[GlobalHandler]', isFatal ? 'FATAL' : 'non-fatal', error);
        saveError('@lastError', JSON.stringify({
          type: 'global',
          fatal: isFatal,
          message: String(error?.message || error),
          stack: String(error?.stack || ''),
          time: new Date().toISOString(),
        }));
        if (originalHandler) originalHandler(error, isFatal);
      });
    }

    // 2. Promise rejection 捕获
    const tracking = require('promise/setimmediate/rejection-tracking');
    if (tracking?.enable) {
      tracking.enable({
        allRejections: true,
        onUnhandled: (id: number, error: any) => {
          console.error('[UnhandledRejection]', id, error);
          saveError('@lastError', JSON.stringify({
            type: 'unhandledRejection',
            id,
            message: String(error?.message || error),
            stack: String(error?.stack || ''),
            time: new Date().toISOString(),
          }));
        },
        onHandled: () => {},
      });
    }

    // 3. console.error 自动捕获 (RedBox 在 release build 不显示, 这里兜底)
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      try {
        const message = args.map(a => {
          if (a instanceof Error) return a.message + '\n' + a.stack;
          try { return JSON.stringify(a); } catch { return String(a); }
        }).join(' ');
        if (message.includes('Warning:') === false && args.some(a => a instanceof Error)) {
          saveError('@lastError', JSON.stringify({
            type: 'consoleError',
            message: message.substring(0, 2000),
            time: new Date().toISOString(),
          }));
        }
      } catch {}
      originalConsoleError(...args);
    };
  }, []);

  // ============ 启动时检查上次崩溃错误 ============
  const [lastError, setLastError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const err = await AsyncStorage.getItem('@lastError');
        if (err) setLastError(err);
      } catch {}
    })();
  }, []);
  const clearLastError = async () => {
    await AsyncStorage.removeItem('@lastError');
    setLastError(null);
  };

  useEffect(() => {
    // 冷启动：通过 VIEW/SEND Intent 启动 App 时获取 URI
    Linking.getInitialURL()
      .then((url) => {
        if (url) handleIncomingUrl(url);
      })
      .catch((err) => {
        console.log('[App] 获取初始 URL 失败:', err);
      });

    // 热启动：App 已在运行时收到新的 URL
    const subscription = Linking.addEventListener('url', (event) => {
      handleIncomingUrl(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  /**
   * 读取外部 URI 指向的文件内容
   * 微信等应用通过 FileProvider 传入的 content:// URI 走新 API（ContentResolver.openInputStream）
   * 普通 file:// URI 走 legacy API 兜底
   * @param {string} uri - 文件 URI（content:// 或 file://）
   * @returns {Promise<string>} 文件内容
   */
  const readImportFile = async (uri: string) => {
    if (!uri) throw new Error('文件 URI 为空');

    // 1) 优先用 fetch() 读取：React Native Android 的 fetch 底层走 OkHttp，
    //    遇到 content:// 时会自动走 ContentResolver.openInputStream，
    //    遇到 file:// 时走 FileInputStream——一次性兼容微信分享 + 本地文件
    try {
      const response = await fetch(uri);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (fetchErr) {
      logError('fetch 读取失败，尝试 Expo 新 API', fetchErr as Error, 'App.readImportFile');

      // 2) fetch 失败时回退到 expo-file-system 新 API
      const normalized = uri.startsWith('file://') || uri.startsWith('content://')
        ? uri
        : `file://${uri}`;
      const file = new NewFile(normalized);
      return await file.text();
    }
  };

  /**
   * 确认导入外部文件
   * 流程：读取文件 → 解析 JSON → 调用 StorageService 导入 → 提示成功并跳回主页
   */
  const handleConfirmImport = async () => {
    if (!pendingImportUri) return;
    setIsImporting(true);
    try {
      const fileContent = await readImportFile(pendingImportUri);
      const backupData = JSON.parse(fileContent);
      await StorageService.importAllData(backupData);

      // 关闭弹窗并清理状态
      const importedName = pendingImportName;
      setPendingImportUri(null);
      setPendingImportName('');
      setIsImporting(false);

      Alert.alert(
        '导入成功',
        `文件 "${importedName}" 已成功导入！\n\n应用将自动跳转到主页加载新数据。`,
        [
          {
            text: '确定',
            onPress: () => {
              if (navigationRef.isReady()) {
                navigationRef.reset({
                  index: 0,
                  routes: [{ name: 'MainTabs' }],
                });
              }
            },
          },
        ]
      );
    } catch (error) {
      logError('从外部应用导入数据失败', error as Error, 'App.handleConfirmImport');
      setIsImporting(false);
      Alert.alert(
        '导入失败',
        `无法导入文件：${(error as Error).message || '请检查文件格式是否为合法的数据备份'}\n\n请使用本 App 内"我的 → 数据导入"功能重新选择文件。`,
        [{ text: '确定' }]
      );
    }
  };

  /**
   * 取消外部文件导入
   */
  const handleCancelImport = () => {
    if (isImporting) return;
    setPendingImportUri(null);
    setPendingImportName('');
  };

  /**
   * 用户在 BOM 导入弹窗中点击「确定」：
   * 1. 用 fetch() 读取微信分享的 xlsx 文件（content:// 走 OkHttp + ContentResolver）
   * 2. 字节数组转 base64 字符串（手写实现，避免依赖不存在的 Buffer）
   * 3. 写入应用缓存目录
   * 4. 通过模块级单例 pendingBomImport 传递文件路径给 BOMScreen
   * 5. 关闭弹窗，跳转到 BOM tab
   * 6. BOMScreen 通过 useNavigationState 监听 navigation state 变化来触发导入
   *    （不依赖 useFocusEffect 在已 focus tab 上是否重跑）
   */
  const handleConfirmBomImport = async () => {
    if (!pendingBomUri) return;
    setIsBomImporting(true);

    // 设备诊断日志（关键：用于排查华为/鸿蒙等特殊机型的兼容性问题）
    const deviceInfo = getDeviceDebugInfo();
    console.log('[BOM-FLOW] ========== 开始处理 BOM 文件 ==========');
    console.log('[BOM-FLOW] 设备信息:', JSON.stringify(deviceInfo));
    console.log('[BOM-FLOW] 文件 URI:', pendingBomUri);
    console.log('[BOM-FLOW] 文件名:', pendingBomName);

    // 解析 URI 关键字段
    let uriInfo = { scheme: 'unknown', host: 'unknown', pathPrefix: 'unknown' };
    try {
      const u = new URL(pendingBomUri);
      uriInfo = {
        scheme: u.protocol.replace(':', ''),
        host: u.host,
        pathPrefix: u.pathname.substring(0, Math.min(60, u.pathname.length)),
      };
    } catch (e) {
      // 某些 URI 格式可能解析失败，不影响主流程
    }
    console.log('[BOM-FLOW] URI 解析:', JSON.stringify(uriInfo));

    try {
      // 1) 用 fetch 读 content:// / file:// 资源为字节数组
      //    鸿蒙 4.x 的 OkHttp 走 AOSP 兼容层，理论上能正常处理 content://
      //    鸿蒙 NEXT 不支持 Android 应用（不会走到这里）
      console.log('[BOM-FLOW] step1: fetch 开始');
      const response = await fetchWithTimeout(pendingBomUri);
      console.log('[BOM-FLOW] step1: fetch 响应 status =', response.status);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      console.log('[BOM-FLOW] step1: 读取字节数 =', bytes.length);

      if (bytes.length === 0) {
        throw new Error('文件内容为空');
      }

      // 2) 字节数组 → base64 字符串（手写实现，零依赖）
      console.log('[BOM-FLOW] step2: base64 编码开始');
      const base64 = encodeBytesToBase64(bytes);
      console.log('[BOM-FLOW] step2: base64 编码完成，长度 =', base64.length);

      // 3) 写入应用缓存目录
      const cacheDir = FileSystem.cacheDirectory || '';
      const safeName = pendingBomName.replace(/[\\/:*?"<>|]/g, '_') || 'imported_bom.xlsx';
      const cachePath = `${cacheDir}import_${Date.now()}_${safeName}`;
      console.log('[BOM-FLOW] step3: 写入缓存路径 =', cachePath);
      await FileSystem.writeAsStringAsync(cachePath, base64, {
        encoding: 'base64',
      });
      console.log('[BOM-FLOW] step3: 缓存写入成功');

      // 4) 写入模块级单例
      pendingBomImport.set(cachePath, pendingBomName);
      console.log('[BOM-FLOW] step4: pendingBomImport.set 完成');

      // 5) 关闭弹窗
      setPendingBomUri(null);
      setPendingBomName('');

      // 6) 跳转到 BOM tab（无论是否已在 BOM tab，都会触发 navigation state 变化）
      if (navigationRef.isReady()) {
        (navigationRef as any).navigate('MainTabs', { screen: 'BOM' });
        console.log('[BOM-FLOW] step6: navigate to BOM tab');
      } else {
        console.warn('[BOM-FLOW] step6: navigationRef not ready, skip navigate');
      }
      console.log('[BOM-FLOW] ========== BOM 文件处理成功 ==========');
    } catch (err) {
      const e = err as Error;
      console.error('[BOM-FLOW] ========== BOM 文件处理失败 ==========');
      console.error('[BOM-FLOW] 设备信息:', JSON.stringify(deviceInfo));
      console.error('[BOM-FLOW] 失败 URI:', pendingBomUri);
      console.error('[BOM-FLOW] 错误信息:', e.message);
      console.error('[BOM-FLOW] 错误堆栈:', e.stack);
      logError('BOM 文件导入失败', e, 'App.handleConfirmBomImport');

      // 针对华为/鸿蒙机型的友好提示
      const isHuaweiHint = deviceInfo.isHuawei
        ? '\n\n【华为/鸿蒙设备提示】\n鸿蒙 4.x 系统对部分 content:// 权限管理较严格。\n如反复失败，可尝试：\n1. 用「QQ」「邮件」等应用先把文件保存到本地，再在 App 内通过"导入 BOM 文件"按钮选择\n2. 升级到最新版鸿蒙系统\n3. 联系开发者并提供设备型号（' + deviceInfo.model + '）'
        : '\n\n如反复失败，请联系开发者并提供设备型号与系统版本。';

      Alert.alert(
        '导入失败',
        `无法导入 BOM 文件：${(e as Error).message || '请检查文件格式是否为合法的 Excel 配单'}${isHuaweiHint}`,
        [{ text: '确定' }]
      );
    } finally {
      setIsBomImporting(false);
    }
  };

  /**
   * 取消 BOM 导入
   */
  const handleCancelBomImport = () => {
    if (isBomImporting) return;
    setPendingBomUri(null);
    setPendingBomName('');
    pendingBomImport.clear();
  };

  return (
    <ErrorBoundary>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={styles.container}>
        <UserProvider>
          <AppNavigator />

        {/* 上次崩溃的错误信息（如果有） */}
        {lastError && (
          <Modal visible={!!lastError} transparent animationType="fade" onRequestClose={clearLastError}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
              <View style={{ backgroundColor: 'white', borderRadius: 8, padding: 16, maxHeight: '80%' }}>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#d32f2f', marginBottom: 8 }}>
                  ⚠️ 上次运行出现错误
                </Text>
                <Text style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                  请把以下信息截图发给开发者
                </Text>
                <ScrollView style={{ maxHeight: 360, backgroundColor: '#fff3e0', padding: 8, borderRadius: 4 }}>
                  <Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#333' }}>
                    {lastError}
                  </Text>
                </ScrollView>
                <TouchableOpacity
                  style={{ backgroundColor: '#1976d2', padding: 12, borderRadius: 8, marginTop: 12, alignItems: 'center' }}
                  onPress={clearLastError}
                >
                  <Text style={{ color: 'white', fontWeight: '600' }}>知道了</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}

        {/* 外部应用分享 JSON 文件时的导入确认弹窗 */}
        <Modal
          visible={!!pendingImportUri}
          transparent={true}
          animationType="fade"
          onRequestClose={handleCancelImport}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>检测到外部数据文件</Text>

              <View style={styles.fileInfoBox}>
                <Text style={styles.fileInfoLabel}>文件名</Text>
                <Text style={styles.fileInfoValue} numberOfLines={2}>
                  {pendingImportName}
                </Text>
              </View>

              <Text style={styles.modalTip}>
                是否将该数据导入到本 App？{'\n'}
                <Text style={styles.modalTipWarn}>
                  注意：此操作将覆盖当前所有数据。
                </Text>
              </Text>

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={handleCancelImport}
                  disabled={isImporting}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelButtonText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.confirmButton]}
                  onPress={handleConfirmImport}
                  disabled={isImporting}
                  activeOpacity={0.7}
                >
                  {isImporting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.confirmButtonText}>确定导入</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* BOM 配单导入确认弹窗（来自微信分享的 Excel 文件） */}
        <Modal
          visible={!!pendingBomUri}
          transparent={false}
          animationType="fade"
          onRequestClose={handleCancelBomImport}
        >
          <View style={styles.bomModalOverlay}>
            <View style={styles.bomModalContent}>
              <Text style={styles.modalTitle}>检测到 BOM 配单文件</Text>

              <View style={styles.fileInfoBox}>
                <Text style={styles.fileInfoLabel}>文件名</Text>
                <Text style={styles.fileInfoValue} numberOfLines={2}>
                  {pendingBomName}
                </Text>
              </View>

              <Text style={styles.modalTip}>
                是否将该 Excel 文件导入到「BOM 配单」列表？{'\n'}
                <Text style={styles.modalTipWarn}>
                  导入后将自动跳转到 BOM 配单界面。
                </Text>
              </Text>

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={handleCancelBomImport}
                  disabled={isBomImporting}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelButtonText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.confirmButton]}
                  onPress={handleConfirmBomImport}
                  disabled={isBomImporting}
                  activeOpacity={0.7}
                >
                  {isBomImporting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.confirmButtonText}>确定导入</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </UserProvider>
      </SafeAreaView>
    </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  // Modal 样式
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  // BOM 导入弹窗：不透明背景 + 圆角白卡
  bomModalOverlay: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  bomModalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 20,
    width: '100%',
    maxWidth: 360,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
    color: '#333',
  },
  fileInfoBox: {
    backgroundColor: '#f5f5f7',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  fileInfoLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  fileInfoValue: {
    fontSize: 14,
    color: '#1976d2',
    fontWeight: '600',
  },
  modalTip: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 20,
  },
  modalTipWarn: {
    color: '#ef6c00',
    fontWeight: '500',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  cancelButton: {
    backgroundColor: '#8E8E93',
    marginRight: 8,
  },
  confirmButton: {
    backgroundColor: '#007AFF',
    marginLeft: 8,
  },
  cancelButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  confirmButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
