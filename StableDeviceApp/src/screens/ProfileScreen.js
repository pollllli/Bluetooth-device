﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿/**
 * 个人中心页面组件
 * 
 * 功能说明：
 * - 用户信息展示
 * - 数据导出功能（导出器件、BOM、分类等数据到JSON文件）
 * - 数据导入功能（从JSON文件导入数据）
 * - 分类管理入口
 * - 关于应用信息展示
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';  // 文件选择器
import * as FileSystem from 'expo-file-system/legacy';   // 文件系统操作
import * as Sharing from 'expo-sharing';                 // 分享功能(单文件兼容保留)
import * as Clipboard from 'expo-clipboard';             // 剪贴板（用于复制导出路径）
import * as ExpoEasyFs from 'expo-easy-fs';              // 下载目录读写（Android 10+ 走 MediaStore）
import StorageService from '../services/StorageService';
import ShelfService from '../services/ShelfService';
import { setPendingAutoConnect } from '../utils/pendingAutoConnect';
import { logError, formatErrorMessage } from '../utils/ErrorHandler';
import { useUser } from '../context/UserContext';
import colors from '../theme/colors';

const ProfileScreen = ({ navigation, route }) => {
  // 获取用户上下文
  const { user, updateUser } = useUser();
  
  // 用户信息状态（当前固定为管理员身份）
  const [userInfo, setUserInfo] = useState({
    username: 'admin',
    role: '管理员',
  });

  // 数据导出相关状态
  const [showExportModal, setShowExportModal] = useState(false); // 是否显示导出多选库存弹窗
  const [shelves, setShelves] = useState([]); // 所有库存
  const [selectedShelfIds, setSelectedShelfIds] = useState(new Set()); // 已选的库存 id
  // 导出成功弹窗信息（null 表示不显示）
  const [exportSuccessInfo, setExportSuccessInfo] = useState(null);
  // 复制按钮反馈状态
  const [pathCopied, setPathCopied] = useState(false);
  // 1.6.3: 导入进度弹窗 (替代原来只用 console.log 看不到进度的体验)
  const [importProgress, setImportProgress] = useState(null); // {fileName, deviceCount, read, total} | null
  const importCancelRef = useRef({ cancelled: false });
  // 数据导入确认弹窗 (替代系统 Alert, 统一圆角风格)
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  // 1.6.5: 流式导出进度 (300+ 器件导出可能要十几秒, 给用户进度反馈)
  const [exportProgress, setExportProgress] = useState(null); // {current, total, shelfName, message, shelfIndex, shelfTotal} | null

  /**
   * 组件挂载时初始化用户信息
   * 当前设计：始终显示为管理员身份
   */
  useEffect(() => {
    setUserInfo({
      username: 'admin',
      role: '管理员',
    });
  }, []);

  /**
   * 显示关于应用信息弹窗
   */
  const handleAbout = () => {
    Alert.alert(
      'PartLit',
      'PartLit v1.2.3\n\n用于管理电子器件的库存和取用\n\n© 2026 PartLit'
    );
  };

  /**
   * 打开数据导出弹窗: 加载所有库存, 让用户多选
   */
  const handleOpenExportModal = async () => {
    try {
      const list = await ShelfService.getShelves();
      setShelves(list);
      // 默认空选: 用户需要自己勾选, 避免一打开就把全部库存选上误操作
      setSelectedShelfIds(new Set());
      setShowExportModal(true);
    } catch (err) {
      Alert.alert('错误', '加载库存列表失败');
    }
  };

  /**
   * 跳转到分类管理页面
   */
  const handleOpenCategoryManagement = () => {
    navigation.navigate('CategoryManagement');
  };

  /**
   * 跳转到库存管理页面（增/删/改名）
   */
  const handleOpenShelfManager = () => {
    navigation.navigate('ShelfManager');
  };

  /**
   * 关闭导出弹窗
   */
  const handleCloseExportModal = () => {
    setShowExportModal(false);
    setSelectedShelfIds(new Set());
  };

  /**
   * 1.6.5: 流式导出单个库存到 documentDirectory 临时文件
   * 替代旧的 writeTempExportFiles (那个会 JSON.stringify(整个 backup) 导致大库存 OOM)
   *
   * @param {Array} selectedShelves - 选中的库存对象数组
   * @param {(p: {current: number, total: number, shelfName: string, message?: string}) => void} [onProgress]
   * @returns {Promise<Array<{documentPath, fileName, deviceCount, embeddedImageCount}>>}
   */
  const streamExportTempFiles = async (selectedShelves, onProgress) => {
    const tempFiles = [];
    for (let i = 0; i < selectedShelves.length; i++) {
      const shelf = selectedShelves[i];
      const safeName = (shelf.name || '未命名库存')
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim() || '未命名库存';
      const fileName = `${safeName}.json`;
      const documentPath = `${FileSystem.documentDirectory}${fileName}`;

      const result = await StorageService.streamExportShelfToFile(
        shelf.id,
        documentPath,
        {
          onProgress: (p) => {
            if (onProgress) {
              onProgress({
                current: p.current || 0,
                total: p.total || 0,
                shelfName: shelf.name || safeName,
                message: p.message || '',
                shelfIndex: i + 1,
                shelfTotal: selectedShelves.length,
              });
            }
          },
        }
      );

      tempFiles.push({
        documentPath,
        fileName,
        deviceCount: result.deviceCount,
        embeddedImageCount: result.embeddedImageCount,
      });
    }
    return tempFiles;
  };

  /**
   * 清理临时文件 (幂等, 失败忽略)
   */
  const cleanupTempExportFiles = async (tempFiles) => {
    for (const f of tempFiles) {
      try {
        await FileSystem.deleteAsync(f.documentPath, { idempotent: true });
      } catch (e) { /* 忽略 */ }
    }
  };

  /**
   * 「分享」按钮
   * 因为微信等大多数 App 不支持多文件接收, 分享只支持单文件:
   * - 选 1 个库存: 分享这个
   * - 选 0 个: 提示至少选一个
   * - 选多个: 取"导出排序中较前的那一个"(即 shelves 数组中的第一个)
   * 导出按钮仍然支持多文件, 把所有选中的 json 一次写到 Download/
   */
  const handleShareFromExportModal = async () => {
    if (selectedShelfIds.size === 0) {
      Alert.alert('提示', '请先勾选一个库存数据再分享');
      return;
    }

    const selected = shelves.filter((s) => selectedShelfIds.has(s.id));
    setShowExportModal(false);

    let tempFiles = [];
    try {
      // 1.6.5: 流式导出 (不再 JSON.stringify 整个 backup, 300+ 器件也不崩)
      tempFiles = await streamExportTempFiles(selected, (p) => {
        setExportProgress(p);
      });
      setExportProgress(null);
      if (tempFiles.length === 0) {
        Alert.alert('错误', '没有可分享的文件');
        return;
      }

      // 分享只支持单文件: 取导出列表中第一个(也就是 shelves 排序中最靠前的)
      const f = tempFiles[0];
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('提示', '当前设备不支持分享功能');
        return;
      }
      const ext = f.fileName.toLowerCase().split('.').pop() || '';
      // 多选时(>1)直接静默取第一个, 不再二次确认(用户已知分享仅支持单文件)
      await Sharing.shareAsync(f.documentPath, {
        mimeType: ext === 'json' ? 'text/plain' : 'application/octet-stream',
        dialogTitle: `分享 ${f.fileName}`,
        UTI: ext === 'json' ? 'public.json' : undefined,
      });
    } catch (err) {
      setExportProgress(null);
      logError('分享失败', err, 'ProfileScreen.handleShareFromExportModal');
      Alert.alert('错误', `分享失败: ${err.message || '请重试'}`);
    } finally {
      await cleanupTempExportFiles(tempFiles);
    }
  };

  /**
   * 关闭操作面板：清理所有中间文件
   */
  const handleCloseExportSuccess = async () => {
    const files = exportSuccessInfo?.files || [];
    for (const f of files) {
      if (f?.documentPath) {
        try {
          await FileSystem.deleteAsync(f.documentPath, { idempotent: true });
        } catch (e) {
          // 清理失败不影响关闭
        }
      }
    }
    setExportSuccessInfo(null);
    setPathCopied(false);
  };

  /**
   * 复制导出文件路径到系统剪贴板
   * 复制成功时按钮短暂显示"已复制"
   */
  const handleCopyExportPath = async () => {
    if (!exportSuccessInfo?.androidVisiblePath) return;
    try {
      await Clipboard.setStringAsync(exportSuccessInfo.androidVisiblePath);
      setPathCopied(true);
      // 2 秒后自动恢复按钮文字
      setTimeout(() => setPathCopied(false), 2000);
    } catch (err) {
      logError('复制导出路径失败', err, 'ProfileScreen.handleCopyExportPath');
      Alert.alert('错误', '复制失败，请手动选择路径文字复制');
    }
  };

  /**
   * 执行多库存数据导出
   *
   * 流程:
   * 1. 校验至少选了 1 个库存
   * 2. 用 exportShelves 一次性生成 N 份 JSON (各只含对应库存的器件)
   * 3. 全部写入下载目录 (走 MediaStore 适配 Android 10+)
   * 4. 弹成功弹窗, 用户点完成关闭 (分享入口已上移到上一级)
   */
  const handleExportData = async () => {
    if (selectedShelfIds.size === 0) {
      Alert.alert('提示', '请至少选择一个库存');
      return;
    }
    const selected = shelves.filter((s) => selectedShelfIds.has(s.id));
    setShowExportModal(false);

    try {
      // 1.6.5: 流式导出 (不再 JSON.stringify 整个 backup, 300+ 器件也不崩)
      //   旧方案: exportShelves 一次性把所有 device + base64 装进 JS 堆 → JSON.stringify → writeAsStringAsync
      //   新方案: streamExportShelfToFile 逐个读图、写完即释放, 内存峰值 < 10MB
      const tempFiles = await streamExportTempFiles(selected, (p) => {
        setExportProgress(p);
      });
      setExportProgress(null);

      // 2. 复制到下载目录 + 收集中间文件路径
      const writtenFiles = [];
      for (const f of tempFiles) {
        try {
          await ExpoEasyFs.copyFileToDownload(f.documentPath, f.fileName);
        } catch (e) {
          console.warn(`写入下载目录失败: ${f.fileName}`, e);
        }
        writtenFiles.push({
          documentPath: f.documentPath,
          fileName: f.fileName,
          deviceCount: f.deviceCount || 0,
        });
      }

      // 3. 弹操作面板
      setExportSuccessInfo({
        files: writtenFiles,
        androidVisiblePath: writtenFiles.length === 1
          ? `Download/${writtenFiles[0].fileName}`
          : `Download/ (共 ${writtenFiles.length} 个文件)`,
      });
    } catch (error) {
      setExportProgress(null);
      logError('导出多库存数据失败', error, 'ProfileScreen.handleExportData');
      Alert.alert('错误', `导出失败: ${error.message || '请重试'}`);
    }
  };

  // 数据导入 (1.4 阶段 2: 流式导入, 200MB+ 文件不崩)
  const handleImportData = async () => {
    // 【重要】弹窗"数据导入"出现就清空当前库存的 BOM + 熄灭所有灯
    // 原因: 用户既然选择导入新数据, 当前库存的 BOM 状态(亮灯、组件列表)就必然会被废弃,
    //       不如在弹窗这一刻就清掉, 避免出现"弹窗已弹但灯还亮着"的视觉割裂,
    //       也避免 importShelfFromFile 内部 setCurrentShelfId 时(覆盖同名库)重复发控制命令
    // 用 .catch 兜底: 即使蓝牙断/模块未注册也不阻塞用户操作
    try { await ShelfService.clearBomAndLights(); } catch (e) { /* ignore */ }

    setShowImportConfirm(true);
  };

  // 弹窗内点击"选择文件": 关闭弹窗后真正进入选文件/导入流程
  const handleImportConfirmPick = () => {
    setShowImportConfirm(false);
    // 等弹窗关闭动画结束再触发系统文件选择器, 避免两个动画叠加
    setTimeout(() => {
      performImport();
    }, 200);
  };

  // 弹窗内点击"取消"
  const handleImportConfirmCancel = () => {
    setShowImportConfirm(false);
  };

  // 实际的文件选择 + 流式导入流程
  const performImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const fileUri = result.assets[0].uri;
      // 关键: 优先用系统返回的文件名, 这样"按文件名判断"才有效
      const fileName = result.assets[0].name || 'imported.json';

      // 1.6.3: 重置取消标志, 显示进度弹窗
      importCancelRef.current.cancelled = false;
      setImportProgress({ fileName, deviceCount: 0, read: 0, total: 0, phase: 'prepare', message: '准备导入...' });

      // 1.4 阶段 2: 直接把 fileUri 喂给流式导入, 不预先 readAsStringAsync + JSON.parse
      // 旧方案 41MB 文件要把整个 JSON 加载到内存再解析 (100MB+ 直接 OOM)
      // 新方案走 fetch + arrayBuffer + 64KB 分块喂 StreamParser, 内存峰值 < 10MB
      let importResult;
      try {
        importResult = await StorageService.streamImportShelfFromFile(
          fileUri,
          fileName,
          {
            onProgress: (p) => {
              // 1.6.6: 处理所有阶段 (reading/parsing/devices-done/done),
              //   老代码只处理 'reading', 导致文件读完后进度条卡住不动
              setImportProgress((prev) => {
                if (!prev) return prev;
                if (p.phase === 'reading') {
                  return {
                    ...prev,
                    phase: 'reading',
                    deviceCount: p.deviceCount || 0,
                    read: p.read || 0,
                    total: p.total || 0,
                    message: '正在读取文件...',
                  };
                }
                if (p.phase === 'parsing') {
                  // 文件已读完, 正在解析; 进度条保持 100%, 状态文字变化
                  return {
                    ...prev,
                    phase: 'parsing',
                    deviceCount: p.deviceCount || 0,
                    read: prev.total || 0,
                    total: prev.total || 0,
                    message: '正在解析数据...',
                  };
                }
                if (p.phase === 'devices-done' || p.phase === 'done') {
                  return {
                    ...prev,
                    phase: p.phase,
                    deviceCount: p.deviceCount || 0,
                    read: prev.total || 0,
                    total: prev.total || 0,
                    message: p.message || (p.phase === 'done' ? '导入完成' : '正在保存数据...'),
                  };
                }
                return prev;
              });
            },
            isCancelled: () => importCancelRef.current.cancelled,
          }
        );
      } catch (importErr) {
        setImportProgress(null);
        // 取消是用户主动行为, 静默返回, 不弹错误
        if (importErr?.message === '导入已取消') {
          console.log('[handleImportData] 用户取消导入');
          return;
        }
        throw importErr;
      }
      setImportProgress(null);

      // 导入完成后清空库存缓存, 重新加载
      ShelfService.clearShelvesCache();

      // 关键: 把"目标库存"绑定的蓝牙标记为待自动连
      // DeviceListScreen 获得焦点时会消费这个标记, 后台静默连, 不弹切库提示
      // streamImportShelfFromFile 返回 sourceBluetoothMac (新命名), 老 importShelfFromFile 返回 bluetoothMac
      const mac = importResult.sourceBluetoothMac || importResult.bluetoothMac || '';
      const bname = importResult.sourceBluetoothName || importResult.bluetoothName || '';
      if (mac) {
        setPendingAutoConnect(mac, bname);
        console.log('[handleImportData] 标记待自动连:', mac, bname);
      }

      const actionLabel = importResult.action === 'add' ? '已新建' : '已覆盖';
      const imageHint = importResult.restoredImageCount
        ? `\n已恢复 ${importResult.restoredImageCount} 张图片`
        : '';
      Alert.alert(
        '导入成功',
        `${actionLabel}库存「${importResult.shelfName}」\n导入 ${importResult.deviceCount} 个器件${imageHint}`,
        [
          {
            text: '确定',
            onPress: () => {
              // 跳到库存首页 (DeviceListTab 是 Tab.Navigator 的第一个 tab, 即默认 tab)
              // 切库动作在 streamImportShelfFromFile 内部已完成, 这里只负责跳转 UI
              navigation.reset({
                index: 0,
                routes: [
                  {
                    name: 'MainTabs',
                    params: { screen: 'DeviceListTab' },
                  },
                ],
              });
            },
          },
        ]
      );
    } catch (error) {
      logError('导入数据失败', error, 'ProfileScreen.handleImportData');
      Alert.alert(
        '错误',
        `导入数据失败: ${error.message || '请检查文件格式并重试'}`
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>PartLit</Text>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.menuContainer}>
          <TouchableOpacity style={styles.menuItem} onPress={handleOpenCategoryManagement}>
            <Text style={styles.menuText}>分类管理</Text>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={handleOpenShelfManager}>
            <Text style={styles.menuText}>库存管理</Text>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={handleOpenExportModal}>
            <Text style={styles.menuText}>数据导出</Text>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={handleImportData}>
            <Text style={styles.menuText}>数据导入</Text>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, styles.lastMenuItem]}
            onPress={handleAbout}
          >
            <Text style={styles.menuText}>PartLit</Text>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* 数据导出: 多选库存弹窗 */}
      <Modal
        visible={showExportModal}
        animationType="slide"
        transparent={true}
        onRequestClose={handleCloseExportModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalContent}>
            {/* 右上角 × 关闭按钮 (取代原来的"取消"按钮) */}
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={handleCloseExportModal}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.modalCloseButtonText}>×</Text>
            </TouchableOpacity>

            <Text style={styles.modalTitle}>数据导出 - 选择库存</Text>
            <Text style={styles.fileNameHint}>
              勾选要导出的库存，分享仅支持单个文件分享
            </Text>

            {/* 库存多选列表 */}
            <View style={styles.shelfListBox}>
              {shelves.map((shelf) => {
                const checked = selectedShelfIds.has(shelf.id);
                return (
                  <TouchableOpacity
                    key={shelf.id}
                    style={styles.shelfRow}
                    onPress={() => {
                      const next = new Set(selectedShelfIds);
                      if (checked) {
                        next.delete(shelf.id);
                      } else {
                        next.add(shelf.id);
                      }
                      setSelectedShelfIds(next);
                    }}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[styles.shelfCheckbox, checked && styles.shelfCheckboxChecked]}
                    >
                      {checked && <Text style={styles.shelfCheckboxTick}>✓</Text>}
                    </View>
                    <Text style={styles.shelfRowName}>{shelf.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 底部按钮: 分享 / 导出 (取代原来的 取消 / 导出) */}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.shareButton]}
                onPress={handleShareFromExportModal}
              >
                <Text style={styles.shareButtonText}>分享</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.submitButton]}
                onPress={handleExportData}
              >
                <Text style={styles.submitButtonText}>
                  导出 ({selectedShelfIds.size})
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 导出成功提示弹窗（精简版：仅路径+复制+两个操作按钮） */}
      <Modal
        visible={!!exportSuccessInfo}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseExportSuccess}
      >
        <View style={styles.successOverlay}>
          <View style={styles.successContent}>
            {/* 文件列表 */}
            {exportSuccessInfo?.files?.length > 0 && (
              <View style={styles.fileListBox}>
                <Text style={styles.infoLabel}>
                  导出成功 ({exportSuccessInfo.files.length} 个文件)
                </Text>
                {exportSuccessInfo.files.map((f) => (
                  <Text key={f.fileName} style={styles.fileListItem} numberOfLines={1}>
                    • {f.fileName} ({f.deviceCount} 个器件)
                  </Text>
                ))}
                <Text style={styles.fileListHint}>已保存到 Download/ 目录</Text>
              </View>
            )}

            {/* 只保留"完成"按钮: 分享入口已上移到上一级, 不再在导出后再分享 */}
            <View style={styles.successButtonRow}>
              <TouchableOpacity
                style={[styles.successActionButton, styles.successOkButton]}
                onPress={handleCloseExportSuccess}
                activeOpacity={0.7}
              >
                <Text style={styles.successOkButtonText}>完成</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 1.6.3: 导入进度弹窗 (替代原来"看不到进度"的体验 + 真正的可取消) */}
      <Modal
        visible={!!importProgress}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          // Android 物理返回键: 视作用户取消
          importCancelRef.current.cancelled = true;
        }}
      >
        <View style={styles.importProgressOverlay}>
          <View style={styles.importProgressContent}>
            <Text style={styles.importProgressTitle}>导入数据</Text>
            {/* 文件名 */}
            {importProgress?.fileName ? (
              <View style={styles.importProgressFileBox}>
                <Text style={styles.importProgressFileLabel}>文件名</Text>
                <Text style={styles.importProgressFileName} numberOfLines={1}>
                  {importProgress.fileName}
                </Text>
              </View>
            ) : null}
            {/* 1.6.7: 进度区域 - 白底 + 高对比度进度条, 不再用浅蓝色背景淹没进度条 */}
            <View style={styles.importProgressSection}>
              {/* 第一行: 状态文字 (左) + 百分比 (右) */}
              <View style={styles.importProgressHeaderRow}>
                <Text style={styles.importProgressStatusText}>
                  {importProgress?.message || '导入中...'}
                </Text>
                <Text style={styles.importProgressPercentText}>
                  {(() => {
                    const phase = importProgress?.phase;
                    if (phase === 'done') return '100%';
                    if (phase === 'devices-done') return '98%';
                    if (phase === 'parsing') {
                      const devCount = importProgress?.deviceCount || 0;
                      return `${Math.min(95, 60 + Math.round(devCount * 0.4))}%`;
                    }
                    if (phase === 'reading' && importProgress?.total > 0) {
                      return `${Math.round((importProgress.read / importProgress.total) * 60)}%`;
                    }
                    return '0%';
                  })()}
                </Text>
              </View>
              {/* 进度条可视化 - 使用 View 实现, 不复用旧的 Unicode 文字方块版本 */}
              {(() => {
                const phase = importProgress?.phase;
                let pct = 0;
                if (phase === 'done') {
                  pct = 100;
                } else if (phase === 'devices-done') {
                  pct = 98;
                } else if (phase === 'parsing') {
                  const devCount = importProgress?.deviceCount || 0;
                  pct = Math.min(95, 60 + devCount * 0.4);
                } else if (phase === 'reading' && importProgress?.total > 0) {
                  pct = (importProgress.read / importProgress.total) * 60;
                }
                const clamped = Math.max(0, Math.min(100, pct));
                return (
                  <View style={styles.importProgressBarTrack}>
                    <View
                      style={[
                        styles.importProgressBarFill,
                        { width: `${clamped}%` },
                      ]}
                    />
                  </View>
                );
              })()}
              {/* 器件数 */}
              <Text style={styles.importProgressDeviceCount}>
                已解析 {importProgress?.deviceCount || 0} 个器件
              </Text>
            </View>
            {/* 按钮行: 取消 + spinner */}
            <View style={styles.importProgressButtonRow}>
              <TouchableOpacity
                style={styles.importProgressCancelButton}
                onPress={() => {
                  // 设标志, streamImportShelfFromFile 下一次 checkCancel() 抛错
                  importCancelRef.current.cancelled = true;
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.importProgressCancelButtonText}>取消</Text>
              </TouchableOpacity>
              <View style={styles.importProgressSpinnerBox}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* 数据导入确认弹窗 (替代系统 Alert, 圆角风格与全站统一, 无文字提示) */}
      <Modal
        visible={showImportConfirm}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
        onRequestClose={handleImportConfirmCancel}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>数据导入</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={handleImportConfirmCancel}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.submitButton]}
                onPress={handleImportConfirmPick}
                activeOpacity={0.7}
              >
                <Text style={styles.submitButtonText}>选择文件</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 1.6.5: 流式导出进度弹窗 (300+ 器件导出可能要十几秒) */}
      <Modal
        visible={!!exportProgress}
        transparent={true}
        animationType="fade"
        onRequestClose={() => { /* 导出不可取消, 等待完成 */ }}
      >
        <View style={styles.importProgressOverlay}>
          <View style={styles.importProgressContent}>
            <Text style={styles.importProgressTitle}>导出数据</Text>
            <View style={styles.importProgressSection}>
              <View style={styles.importProgressHeaderRow}>
                <Text style={styles.importProgressStatusText}>
                  {exportProgress?.shelfName || '导出中...'}
                </Text>
                <Text style={styles.importProgressPercentText}>
                  {exportProgress?.total > 0
                    ? `${Math.min(100, Math.round((exportProgress.current / exportProgress.total) * 100))}%`
                    : '0%'}
                </Text>
              </View>
              {(() => {
                const pct = exportProgress?.total > 0
                  ? Math.min(100, (exportProgress.current / exportProgress.total) * 100)
                  : 0;
                const filled = Math.round(pct / 5);
                const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, 20 - filled));
                return <Text style={styles.importProgressBarText}>{bar}</Text>;
              })()}
              <Text style={styles.importProgressDeviceCount}>
                {exportProgress?.message || `已导出 ${exportProgress?.current || 0}/${exportProgress?.total || 0} 个器件`}
              </Text>
            </View>
            <View style={styles.importProgressButtonRow}>
              <View style={styles.importProgressSpinnerBox}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: 60,
  },
  header: {
    backgroundColor: colors.bgSecondary,
    paddingTop: 4,
    paddingBottom: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginTop: 4,
  },
  headerTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  userInfoContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: colors.bgSecondary,
    marginBottom: 16,
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.textInverse,
  },
  username: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  role: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  menuContainer: {
    backgroundColor: 'transparent',   // 容器变透明, 5 个 menuItem 各自成独立圆角标签
    paddingTop: 12,                   // 与 header 之间留 12px 间距 (避免紧贴)
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginHorizontal: 16,             // 标签与屏幕边距
    marginBottom: 12,                 // 标签之间留 12px 空白
    backgroundColor: colors.bgSecondary,
    borderRadius: 28,                 // pill 形圆角标签, 与底栏一致
    // 去掉 borderBottomWidth, 改用 box-shadow + elevation 上浮
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 7,
    overflow: 'hidden',               // 圆角 + overflow 防止内容溢出
  },
  lastMenuItem: {
    marginBottom: 16,                 // 最后一个标签底部多一点空白 (视觉收尾)
  },
  menuText: {
    fontSize: 16,
  },
  menuArrow: {
    fontSize: 20,
    color: colors.textMuted,
  },
  // 模态框样式
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.bgOverlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 12,
    padding: 20,
    width: '85%',
    maxWidth: 400,
  },
  // 导出弹窗右上角 × 关闭按钮
  modalCloseButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  modalCloseButtonText: {
    fontSize: 28,
    color: colors.textMuted,
    fontWeight: '300',
    lineHeight: 30,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
    color: colors.textPrimary,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 28,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: colors.textMuted,
    marginRight: 8,
  },
  submitButton: {
    backgroundColor: colors.accent,
    marginLeft: 8,
  },
  cancelButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: 'bold',
  },
  submitButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: 'bold',
  },
  fileNameInput: {
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    fontSize: 16,
  },
  fileNameHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
    marginBottom: 4,
  },
  shelfListBox: {
    marginVertical: 12,
    maxHeight: 300,
  },
  shelfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  shelfCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  shelfCheckboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  shelfCheckboxTick: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
  shelfRowName: {
    fontSize: 15,
    color: colors.textPrimary,
    flex: 1,
  },
  fileListBox: {
    backgroundColor: colors.successBg,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  fileListItem: {
    fontSize: 13,
    color: colors.textPrimary,
    marginTop: 4,
  },
  fileListHint: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 8,
    fontStyle: 'italic',
  },
  // ===== 导出成功弹窗样式 =====
  successOverlay: {
    flex: 1,
    backgroundColor: colors.bgOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  successContent: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    elevation: 8,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  successHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successIcon: {
    fontSize: 24,
    color: colors.accent,
    fontWeight: 'bold',
    marginRight: 8,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  infoBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  pathBox: {
    backgroundColor: colors.accentBg,
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    marginBottom: 12,
  },
  pathRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  pathValue: {
    flex: 1,
    fontSize: 13,
    color: colors.accent,
    fontWeight: '500',
    marginRight: 8,
    lineHeight: 18,
  },
  copyButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 60,
    alignItems: 'center',
  },
  copyButtonDone: {
    backgroundColor: colors.success,
  },
  copyButtonText: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: '600',
  },
  successTip: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 16,
  },
  successOkButton: {
    backgroundColor: colors.accent,
    paddingVertical: 12,
    borderRadius: 28,
    alignItems: 'center',
    flex: 1,
  },
  successOkButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: 'bold',
  },
  successButtonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  successActionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButton: {
    backgroundColor: colors.success,
    marginRight: 8,
  },
  shareButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: 'bold',
  },
  // 1.6.3: 导入进度弹窗样式
  importProgressOverlay: {
    flex: 1,
    backgroundColor: colors.bgOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  importProgressContent: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 360,
  },
  importProgressTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  importProgressFileBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  importProgressFileLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  importProgressFileName: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  // 1.6.7: 进度区域 - 透明背景 (用弹窗白底), 不再用浅蓝色淹没进度条
  importProgressSection: {
    marginBottom: 16,
  },
  // 1.6.7: 状态文字 + 百分比在同一行 (左状态, 右百分比)
  importProgressHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  importProgressStatusText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '500',
    flexShrink: 1,
  },
  importProgressDeviceCount: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 8,
  },
  // 1.6.7: 文字进度条样式 - 用 Unicode 方块字符, 不用 View
  importProgressBarText: {
    fontSize: 16,
    color: colors.accent,
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginTop: 6,
    marginBottom: 2,
  },
  // 进度条可视化 - View 实现 (track + fill), 不复用旧的 Unicode 文字方块版本
  importProgressBarTrack: {
    height: 8,
    backgroundColor: colors.bgElevated,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  importProgressBarFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 4,
  },
  // 1.6.7: 百分比文字 - 大号加粗, 右对齐
  importProgressPercentText: {
    fontSize: 18,
    color: colors.accent,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginLeft: 8,
  },
  importProgressButtonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  importProgressCancelButton: {
    backgroundColor: colors.bgElevated,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 28,
    minWidth: 100,
    alignItems: 'center',
  },
  importProgressCancelButtonText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '500',
  },
  importProgressSpinnerBox: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default ProfileScreen;