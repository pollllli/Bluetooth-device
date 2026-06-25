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
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';  // 文件选择器
import * as FileSystem from 'expo-file-system/legacy';   // 文件系统操作
import * as Sharing from 'expo-sharing';                 // 分享功能
import * as Clipboard from 'expo-clipboard';             // 剪贴板（用于复制导出路径）
import * as ExpoEasyFs from 'expo-easy-fs';              // 下载目录读写（Android 10+ 走 MediaStore）
import StorageService from '../services/StorageService';
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
  const [exportFileName, setExportFileName] = useState(''); // 导出文件名
  const [showExportModal, setShowExportModal] = useState(false); // 是否显示导出弹窗
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
   * 打开数据导出弹窗
   * 自动生成默认文件名（格式：器件数据_日期.json）
   */
  const handleOpenExportModal = () => {
    const defaultName = `器件数据_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
    setExportFileName(defaultName);
    setShowExportModal(true);
  };

  /**
   * 跳转到分类管理页面
   */
  const handleOpenCategoryManagement = () => {
    navigation.navigate('CategoryManagement');
  };

  /**
   * 关闭导出弹窗并清空文件名
   */
  const handleCloseExportModal = () => {
    setShowExportModal(false);
    setExportFileName('');
  };

  /**
   * 关闭操作面板：取消导出
   * 清理文档目录的中间文件，避免无意义占用空间
   */
  const handleCloseExportSuccess = async () => {
    const path = exportSuccessInfo?.documentPath;
    if (path) {
      try {
        await FileSystem.deleteAsync(path, { idempotent: true });
      } catch (e) {
        // 清理失败不影响关闭
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
   * 「分享」按钮：唤起系统分享面板
   * 注意：不能在 shareAsync 之前清理文件，否则分享面板找不到文件
   * 分享面板关闭后（无论是否真的分享了）再清理中间文件
   */
  const handleShareFromSuccess = async () => {
    if (!exportSuccessInfo?.documentPath) return;
    const { documentPath, fileName } = exportSuccessInfo;

    // 根据文件扩展名自动选择正确的 MIME
    // 微信好友分享限制：
    //   ✅ 接受：image/*, video/*, pdf, doc(x), xls(x), ppt(x), txt
    //   ❌ 拒绝：json（任何手机都会被拒，这是微信策略）
    //
    // ⚠️ 重要：json 不用 application/json，原因：
    //   华为/鸿蒙对 Intent 中的 application/json MIME 有系统级白名单过滤，
    //   即使 OPPO/Vivo/小米/三星 能正常分享 json，
    //   华为手机会在系统层拦截，微信收不到文件 → 显示"暂不支持分享"。
    //   改用 text/plain 后，所有 Android OEM 厂商都会放行。
    const ext = fileName.toLowerCase().split('.').pop() || '';
    const mimeMap = {
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      xls: 'application/vnd.ms-excel',
      csv: 'text/csv',
      txt: 'text/plain',
      pdf: 'application/pdf',
      // 关键：json 用 text/plain 而不是 application/json，绕过华为 MIME 拦截
      json: 'text/plain',
    };
    const mimeType = mimeMap[ext] || 'application/octet-stream';

    // 先关闭操作面板，再唤起分享面板（避免遮挡）
    setExportSuccessInfo(null);
    setPathCopied(false);
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(documentPath, {
          mimeType,
          dialogTitle: `分享 ${fileName}`,
          UTI: ext === 'json' ? 'public.json' : undefined,
        });
      } else {
        Alert.alert('提示', '当前设备不支持分享功能');
      }
    } catch (err) {
      logError('主动分享失败', err, 'ProfileScreen.handleShareFromSuccess');
      Alert.alert('错误', `分享失败：${err.message || '请重试'}`);
    } finally {
      // 无论分享成功/失败/取消，都清理中间文件
      try {
        await FileSystem.deleteAsync(documentPath, { idempotent: true });
      } catch (e) {
        // 忽略
      }
    }
  };

  /**
   * 执行数据导出操作
   *
   * 流程：
   * 1. 验证文件名不为空
   * 2. 从存储服务导出所有数据（器件、BOM、分类等）
   * 3. 将数据序列化为JSON格式
   * 4. 先写入应用文档目录（用于分享功能，不删除）
   * 5. 再复制到公共下载目录（expo-easy-fs 走 MediaStore 适配 Android 10+ scoped storage）
   * 6. 弹出"导出成功"操作面板：展示默认下载路径+复制+分享+完成按钮
   * 7. 不主动唤起系统分享面板——避免 expo-sharing 在 Android 上无法区分
   *    "用户分享"与"切后台"导致误判为"导出成功"的体验问题
   * 8. 文件已保存到下载目录，用户可随时通过面板里的「分享」按钮主动唤起分享
   */
  const handleExportData = async () => {
    // 验证文件名
    if (!exportFileName.trim()) {
      Alert.alert('提示', '请输入文件名');
      return;
    }

    try {
      // 导出所有数据（包含器件、BOM、分类等）
      const backupData = await StorageService.exportAllData();
      // 序列化为格式化的JSON
      const backupJson = JSON.stringify(backupData, null, 2);

      // 确保文件名以.json结尾
      const fileName = exportFileName.endsWith('.json') ? exportFileName : `${exportFileName}.json`;

      // 写入应用文档目录作为中间文件（供「确认」/「分享」使用）
      // 注意：此时还没写入下载目录，文件仅存在 app 内部
      const documentPath = `${FileSystem.documentDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(documentPath, backupJson);

      // 关闭文件名输入弹窗
      setShowExportModal(false);
      setExportFileName('');

      // 弹出"操作面板"，等待用户选择如何保存
      // androidVisiblePath 显示"将要保存到"的默认下载路径
      setExportSuccessInfo({
        fileName,
        androidVisiblePath: `Download/${fileName}`,
        documentPath,
      });
    } catch (error) {
      logError('准备导出数据失败', error, 'ProfileScreen.handleExportData');
      Alert.alert('错误', `导出数据失败: ${error.message || '请重试'}`);
    }
  };

  /**
   * 「确认」按钮：写入到默认下载目录
   * expo-easy-fs 的 copyFileToDownload 内部走 MediaStore，兼容 Android 10+ scoped storage
   */
  const handleConfirmExport = async () => {
    if (!exportSuccessInfo?.documentPath) return;
    const { documentPath, fileName } = exportSuccessInfo;
    try {
      await ExpoEasyFs.copyFileToDownload(documentPath, fileName);
      Alert.alert('成功', `文件已保存到 Download/${fileName}`);
      handleCloseExportSuccess();
    } catch (err) {
      logError('保存到下载目录失败', err, 'ProfileScreen.handleConfirmExport');
      Alert.alert('错误', `保存到下载目录失败：${err.message || '请重试'}`);
    }
  };

  // 数据导入
  const handleImportData = async () => {
    Alert.alert('数据导入', '此操作将覆盖当前所有数据，确定要继续吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '确定',
        style: 'destructive',
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
            const fileContent = await FileSystem.readAsStringAsync(fileUri);
            const backupData = JSON.parse(fileContent);

            await StorageService.importAllData(backupData);

            Alert.alert('成功', '数据导入成功！\n\n应用将重启以加载新数据。', [
              {
                text: '确定',
                onPress: async () => {
                  navigation.reset({
                    index: 0,
                    routes: [{ name: 'MainTabs' }],
                  });
                },
              },
            ]);
          } catch (error) {
            logError('导入数据失败', error, 'ProfileScreen.handleImportData');
            Alert.alert(
              '错误',
              `导入数据失败: ${error.message || '请检查文件格式并重试'}`
            );
          }
        },
      },
    ]);
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

      {/* 数据导出文件名输入弹窗 */}
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
            <Text style={styles.modalTitle}>数据导出</Text>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>文件名</Text>
              <TextInput
                style={styles.fileNameInput}
                value={exportFileName}
                onChangeText={setExportFileName}
                placeholder="请输入文件名"
                autoFocus={true}
              />
              <Text style={styles.fileNameHint}>默认命名格式：器件数据_日期</Text>
              <Text style={styles.fileNameHint}>点击导出后可选择保存位置</Text>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={handleCloseExportModal}
              >
                <Text style={styles.cancelButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.submitButton]}
                onPress={handleExportData}
              >
                <Text style={styles.submitButtonText}>导出</Text>
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
            {/* 文件保存路径 + 复制按钮 */}
            <View style={styles.pathBox}>
              <Text style={styles.infoLabel}>文件保存路径</Text>
              <View style={styles.pathRow}>
                <Text
                  style={styles.pathValue}
                  numberOfLines={2}
                  ellipsizeMode="middle"
                >
                  {exportSuccessInfo?.androidVisiblePath}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.copyButton,
                    pathCopied && styles.copyButtonDone,
                  ]}
                  onPress={handleCopyExportPath}
                  activeOpacity={0.7}
                >
                  <Text style={styles.copyButtonText}>
                    {pathCopied ? '已复制' : '复制'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.successButtonRow}>
              <TouchableOpacity
                style={[styles.successActionButton, styles.shareButton]}
                onPress={handleShareFromSuccess}
                activeOpacity={0.7}
              >
                <Text style={styles.shareButtonText}>分享</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.successActionButton, styles.successOkButton]}
                onPress={handleConfirmExport}
                activeOpacity={0.7}
              >
                <Text style={styles.successOkButtonText}>确认</Text>
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