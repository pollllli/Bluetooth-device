/**
 * 个人中心页面组件
 * 
 * 功能说明：
 * - 用户信息展示
 * - 数据导出功能（导出器件、BOM、分类等数据到JSON文件）
 * - 数据导入功能（从JSON文件导入数据）
 * - 分类管理入口
 * - 关于应用信息展示
 */
import React, { useState, useEffect } from 'react';
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
      '关于',
      '器件管理系统 v1.0.0\n\n用于管理电子器件的库存和取用\n\n© 2026 器件管理系统'
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
   * 把 exportList 写到 documentDirectory 临时目录, 返回 [{documentPath, fileName}, ...]
   * 注意: 不写到 Download, 分享完 / 关闭时统一清理
   */
  const writeTempExportFiles = async (exportList) => {
    const tempFiles = [];
    for (const item of exportList) {
      const json = JSON.stringify(item.backup, null, 2);
      const documentPath = `${FileSystem.documentDirectory}${item.fileName}`;
      await FileSystem.writeAsStringAsync(documentPath, json);
      tempFiles.push({ documentPath, fileName: item.fileName });
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
      const exportList = await StorageService.exportShelves(selected);
      tempFiles = await writeTempExportFiles(exportList);
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
      // 1. 一次性生成 N 份 JSON 对象
      const exportList = await StorageService.exportShelves(selected);

      // 2. 写入下载目录 + 收集中间文件路径
      const writtenFiles = [];
      for (const item of exportList) {
        const json = JSON.stringify(item.backup, null, 2);
        const documentPath = `${FileSystem.documentDirectory}${item.fileName}`;
        await FileSystem.writeAsStringAsync(documentPath, json);
        try {
          await ExpoEasyFs.copyFileToDownload(documentPath, item.fileName);
        } catch (e) {
          console.warn(`写入下载目录失败: ${item.fileName}`, e);
        }
        writtenFiles.push({
          documentPath,
          fileName: item.fileName,
          deviceCount: item.backup?.summary?.deviceCount || 0,
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
      logError('导出多库存数据失败', error, 'ProfileScreen.handleExportData');
      Alert.alert('错误', `导出失败: ${error.message || '请重试'}`);
    }
  };

  // 数据导入 (新流程: 按文件名作为库存名, 同名覆盖/异名新增)
  const handleImportData = async () => {
    // 【重要】弹窗"数据导入"出现就清空当前库存的 BOM + 熄灭所有灯
    // 原因: 用户既然选择导入新数据, 当前库存的 BOM 状态(亮灯、组件列表)就必然会被废弃,
    //       不如在弹窗这一刻就清掉, 避免出现"弹窗已弹但灯还亮着"的视觉割裂,
    //       也避免 importShelfFromFile 内部 setCurrentShelfId 时(覆盖同名库)重复发控制命令
    // 用 .catch 兜底: 即使蓝牙断/模块未注册也不阻塞用户操作
    try { await ShelfService.clearBomAndLights(); } catch (e) { /* ignore */ }

    Alert.alert(
      '数据导入',
      '系统将根据文件名判断:\n• 同名库存 → 覆盖该库存的器件\n• 异名库存 → 自动新增为新库存\n\n此操作不会影响其他库存。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '选择文件',
          onPress: async () => {
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
              const fileContent = await FileSystem.readAsStringAsync(fileUri);
              const backupData = JSON.parse(fileContent);

              // 用新的"按文件名导入"流程, 替代旧的"覆盖全部数据"
              const importResult = await StorageService.importShelfFromFile(fileName, backupData);

              // 导入完成后清空库存缓存, 重新加载
              ShelfService.clearShelvesCache();

              // 关键: 把"目标库存"绑定的蓝牙标记为待自动连
              // DeviceListScreen 获得焦点时会消费这个标记, 后台静默连, 不弹切库提示
              if (importResult.bluetoothMac) {
                setPendingAutoConnect(importResult.bluetoothMac, importResult.bluetoothName || '');
                console.log('[handleImportData] 标记待自动连:', importResult.bluetoothMac, importResult.bluetoothName);
              }

              const actionLabel = importResult.action === 'add' ? '已新建' : '已覆盖';
              Alert.alert(
                '导入成功',
                `${actionLabel}库存「${importResult.shelfName}」`,
                [
                  {
                    text: '确定',
                    onPress: () => {
                      // 跳到库存首页 (DeviceListTab 是 Tab.Navigator 的第一个 tab, 即默认 tab)
                      // 切库动作在 importShelfFromFile 内部已完成, 这里只负责跳转 UI
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
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>设置</Text>
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
            <Text style={styles.menuText}>关于</Text>
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    paddingTop: 60,
  },
  header: {
    backgroundColor: '#e0e0e0',
    padding: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    marginTop: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  userInfoContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: 'white',
    marginBottom: 16,
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: 'white',
  },
  username: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  role: {
    fontSize: 14,
    color: '#666',
  },
  menuContainer: {
    backgroundColor: 'white',
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  lastMenuItem: {
    borderBottomWidth: 0,
  },
  menuText: {
    fontSize: 16,
  },
  menuArrow: {
    fontSize: 20,
    color: '#999',
  },
  // 模态框样式
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
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
    color: '#999',
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
    color: '#333',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#8E8E93',
    marginRight: 8,
  },
  submitButton: {
    backgroundColor: '#007AFF',
    marginLeft: 8,
  },
  cancelButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  fileNameInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    fontSize: 16,
  },
  fileNameHint: {
    fontSize: 12,
    color: '#999',
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
    borderBottomColor: '#eee',
  },
  shelfCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  shelfCheckboxChecked: {
    backgroundColor: '#1976d2',
    borderColor: '#1976d2',
  },
  shelfCheckboxTick: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  shelfRowName: {
    fontSize: 15,
    color: '#333',
    flex: 1,
  },
  fileListBox: {
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  fileListItem: {
    fontSize: 13,
    color: '#333',
    marginTop: 4,
  },
  fileListHint: {
    fontSize: 11,
    color: '#666',
    marginTop: 8,
    fontStyle: 'italic',
  },
  // ===== 导出成功弹窗样式 =====
  successOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  successContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    elevation: 8,
    shadowColor: '#000',
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
    color: '#007AFF',
    fontWeight: 'bold',
    marginRight: 8,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  infoBox: {
    backgroundColor: '#f5f5f7',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 13,
    color: '#333',
    lineHeight: 18,
  },
  pathBox: {
    backgroundColor: '#e8f0fe',
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
    color: '#1976d2',
    fontWeight: '500',
    marginRight: 8,
    lineHeight: 18,
  },
  copyButton: {
    backgroundColor: '#1976d2',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 60,
    alignItems: 'center',
  },
  copyButtonDone: {
    backgroundColor: '#2e7d32',
  },
  copyButtonText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
  },
  successTip: {
    fontSize: 12,
    color: '#666',
    lineHeight: 18,
    marginBottom: 16,
  },
  successOkButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    flex: 1,
  },
  successOkButtonText: {
    color: 'white',
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
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButton: {
    backgroundColor: '#34c759',
    marginRight: 8,
  },
  shareButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default ProfileScreen;