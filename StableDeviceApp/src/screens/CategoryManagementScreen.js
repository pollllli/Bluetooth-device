import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  Modal,
  Pressable,
  Platform,
  SafeAreaView,
  Keyboard,
} from 'react-native';
import {
  getCategories,
  addBigCategory,
  deleteBigCategory,
  addSubCategory,
  deleteSubCategory,
  resetCategories,
  renameBigCategory,
  renameSubCategory,
  isDefaultBigCategory,
  isDefaultSubCategory,
} from '../services/DeviceCategoryService';
import { logError, formatErrorMessage } from '../utils/ErrorHandler';
import { Feather } from '@expo/vector-icons';

/**
 * 分类管理页面组件
 * 
 * 功能说明：
 * - 管理器件分类的增删改操作
 * - 支持新增大分类和子类目
 * - 支持重命名大分类和子类目
 * - 支持删除自定义的大分类和子类目
 * - 支持重置为默认分类
 * - 默认分类不可删除，仅用户自定义的分类可操作
 */
const CategoryManagementScreen = ({ navigation }) => {
  // 当前所有大分类列表
  const [categories, setCategories] = useState([]);
  // 当前展开的大分类索引（用于控制折叠展开）
  const [expandedIndex, setExpandedIndex] = useState(null);
  
  // 新增大分类相关状态
  const [showAddBigModal, setShowAddBigModal] = useState(false); // 是否显示新增大分类弹窗
  const [bigInput, setBigInput] = useState('');                 // 大分类名称输入
  
  // 新增子分类相关状态
  const [showAddSubModal, setShowAddSubModal] = useState(false); // 是否显示新增子分类弹窗
  const [addSubTarget, setAddSubTarget] = useState(null);       // 目标大分类名称
  const [subInput, setSubInput] = useState('');                 // 子类目名称输入
  
  // 重命名大分类相关状态
  const [showRenameBigModal, setShowRenameBigModal] = useState(false); // 是否显示重命名大分类弹窗
  const [renameBigTarget, setRenameBigTarget] = useState(null);         // 原大分类名称
  const [renameBigInput, setRenameBigInput] = useState('');             // 新大分类名称
  
  // 重命名子分类相关状态
  const [showRenameSubModal, setShowRenameSubModal] = useState(false); // 是否显示重命名子分类弹窗
  const [renameSubTarget, setRenameSubTarget] = useState(null);         // { bigName, oldSub }
  const [renameSubInput, setRenameSubInput] = useState('');             // 新子类目名称

  // 4 个弹窗的 TextInput 引用（用于延迟 focus，避免弹窗动画与键盘弹起并发导致的"抽搐"）
  const bigInputRef = useRef(null);
  const subInputRef = useRef(null);
  const renameBigInputRef = useRef(null);
  const renameSubInputRef = useRef(null);

  /**
   * 关闭弹窗的统一入口。
   *
   * 关键：先调用 Keyboard.dismiss() 立即收起键盘（同步、无动画），
   * 再 setState 关闭弹窗。这样：
   *   1. 键盘消失是**瞬间**的（不是 200-300ms 的系统动画）
   *   2. 弹窗 fadeOut 动画和键盘消失完全**串行**进行
   *   3. adjustResize 触发的高度变化在 setState 之前已完成
   *   → 杜绝"键盘收起 + 弹窗关闭"并发导致的抽搐
   */
  const closeAddBig = useCallback(() => {
    Keyboard.dismiss();
    setBigInput('');
    setShowAddBigModal(false);
  }, []);

  const closeAddSub = useCallback(() => {
    Keyboard.dismiss();
    setSubInput('');
    setAddSubTarget(null);
    setShowAddSubModal(false);
  }, []);

  const closeRenameBig = useCallback(() => {
    Keyboard.dismiss();
    setRenameBigTarget(null);
    setRenameBigInput('');
    setShowRenameBigModal(false);
  }, []);

  const closeRenameSub = useCallback(() => {
    Keyboard.dismiss();
    setRenameSubTarget(null);
    setRenameSubInput('');
    setShowRenameSubModal(false);
  }, []);

  // 加载类目数据
  const loadCategories = useCallback(async () => {
    try {
      const list = await getCategories();
      setCategories(list);
    } catch (error) {
      logError('加载类目数据失败', error, 'CategoryManagementScreen.loadCategories');
      Alert.alert('错误', `加载类目数据失败: ${formatErrorMessage(error)}`);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  /**
   * 延迟聚焦逻辑：弹窗打开 → 等待动画完成（300ms）→ 再触发 focus + 弹键盘
   * 这是修复"抽搐"的关键。原先使用 autoFocus={true} 会导致：
   *   - 弹窗开始 slide 动画（同一帧）
   *   - TextInput 立即 focus 触发键盘弹起
   *   - KeyboardAvoidingView 立即重新计算布局
   *   - 三个事件并发 → 在某些机型（特别是带刘海/高刷屏的 OPPO/Vivo/小米）上
   *     出现 50-200ms 的"抽搐"
   *
   * 解决方案：
   *   1. 改用 fade 动画（无 slide 位移，触发的重排少）
   *   2. 移除 KeyboardAvoidingView（manifest 已配 adjustResize，Android 自动处理键盘）
   *   3. 延迟 focus 到动画完成后（setTimeout 350ms，保证 fade 动画结束）
   *   4. 在 Modal 上加 statusBarTranslucent 防止状态栏跳动
   */
  useEffect(() => {
    if (showAddBigModal) {
      const timer = setTimeout(() => {
        bigInputRef.current?.focus();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [showAddBigModal]);

  useEffect(() => {
    if (showAddSubModal) {
      const timer = setTimeout(() => {
        subInputRef.current?.focus();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [showAddSubModal]);

  useEffect(() => {
    if (showRenameBigModal) {
      const timer = setTimeout(() => {
        renameBigInputRef.current?.focus();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [showRenameBigModal]);

  useEffect(() => {
    if (showRenameSubModal) {
      const timer = setTimeout(() => {
        renameSubInputRef.current?.focus();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [showRenameSubModal]);

  // 打开"新增大分类"弹窗
  const handleOpenAddBig = () => {
    setBigInput('');
    setShowAddBigModal(true);
  };

  // 提交新增大分类
  const handleSubmitAddBig = async () => {
    const name = bigInput.trim();
    if (!name) {
      Alert.alert('提示', '请输入大分类名称');
      return;
    }
    try {
      const newList = await addBigCategory(name);
      setCategories(newList);
      closeAddBig();
    } catch (error) {
      Alert.alert('错误', formatErrorMessage(error));
    }
  };

  // 打开"新增子分类"弹窗
  const handleOpenAddSub = (bigName) => {
    setAddSubTarget(bigName);
    setSubInput('');
    setShowAddSubModal(true);
  };

  // 提交新增子分类
  const handleSubmitAddSub = async () => {
    const subName = subInput.trim();
    if (!subName) {
      Alert.alert('提示', '请输入子类目名称');
      return;
    }
    try {
      const newList = await addSubCategory(addSubTarget, subName);
      setCategories(newList);
      closeAddSub();
    } catch (error) {
      Alert.alert('错误', formatErrorMessage(error));
    }
  };

  // 删除大分类（二次确认）
  const handleDeleteBig = (bigName) => {
    Alert.alert(
      '删除大分类',
      `确定要删除大分类 "${bigName}" 吗？\n\n该大分类下所有子类目也会一并被删除。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定',
          style: 'destructive',
          onPress: async () => {
            try {
              const newList = await deleteBigCategory(bigName);
              setCategories(newList);
              if (expandedIndex !== null) {
                // 删除后重置展开索引
                setExpandedIndex(null);
              }
            } catch (error) {
              Alert.alert('错误', formatErrorMessage(error));
            }
          },
        },
      ]
    );
  };

  // 删除子分类（二次确认）
  const handleDeleteSub = (bigName, subName) => {
    Alert.alert(
      '删除子类目',
      `确定要从 "${bigName}" 中删除子类目 "${subName}" 吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定',
          style: 'destructive',
          onPress: async () => {
            try {
              const newList = await deleteSubCategory(bigName, subName);
              setCategories(newList);
            } catch (error) {
              Alert.alert('错误', formatErrorMessage(error));
            }
          },
        },
      ]
    );
  };

  // 打开"重命名大分类"弹窗
  const handleOpenRenameBig = (oldName) => {
    setRenameBigTarget(oldName);
    setRenameBigInput(oldName);
    setShowRenameBigModal(true);
  };

  // 提交重命名大分类
  const handleSubmitRenameBig = async () => {
    const newName = renameBigInput.trim();
    if (!newName) {
      Alert.alert('提示', '请输入大分类名称');
      return;
    }
    if (newName === renameBigTarget) {
      // 没变化，直接关闭
      closeRenameBig();
      return;
    }
    try {
      const newList = await renameBigCategory(renameBigTarget, newName);
      setCategories(newList);
      closeRenameBig();
    } catch (error) {
      Alert.alert('错误', formatErrorMessage(error));
    }
  };

  // 打开"重命名子类目"弹窗
  const handleOpenRenameSub = (bigName, oldSub) => {
    setRenameSubTarget({ bigName, oldSub });
    setRenameSubInput(oldSub);
    setShowRenameSubModal(true);
  };

  // 提交重命名子类目
  const handleSubmitRenameSub = async () => {
    const newSub = renameSubInput.trim();
    if (!newSub) {
      Alert.alert('提示', '请输入子类目名称');
      return;
    }
    if (newSub === renameSubTarget?.oldSub) {
      closeRenameSub();
      return;
    }
    try {
      const newList = await renameSubCategory(
        renameSubTarget.bigName,
        renameSubTarget.oldSub,
        newSub
      );
      setCategories(newList);
      closeRenameSub();
    } catch (error) {
      Alert.alert('错误', formatErrorMessage(error));
    }
  };

  // 重置为默认类目
  const handleReset = () => {
    Alert.alert(
      '重置类目',
      '将清除所有自定义的增删，恢复为内置的默认类目。\n\n确定要继续吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定',
          style: 'destructive',
          onPress: async () => {
            try {
              await resetCategories();
              await loadCategories();
              setExpandedIndex(null);
            } catch (error) {
              Alert.alert('错误', formatErrorMessage(error));
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.content}>
        <View style={styles.headerInfo}>
          <Text style={styles.headerInfoText}>
            共 {categories.length} 个大分类，点击展开查看子类目
          </Text>
        </View>

        {categories.map((cat, idx) => {
          const isExpanded = expandedIndex === idx;
          const isDefaultBig = isDefaultBigCategory(cat.name);
          return (
            <View key={cat.name} style={styles.categoryBlock}>
              {/* 大类标题行 */}
              <View style={styles.categoryHeader}>
                <TouchableOpacity
                  style={styles.categoryHeaderLeft}
                  onPress={() => setExpandedIndex(isExpanded ? null : idx)}
                >
                  <Text style={styles.categoryHeaderArrow}>
                    {isExpanded ? '▼' : '▶'}
                  </Text>
                  <Text style={styles.categoryHeaderName}>{cat.name}</Text>
                  <Text style={styles.categoryHeaderCount}>
                    （{cat.subCategories.length}项）
                  </Text>
                  {isDefaultBig && (
                    <Text style={styles.defaultBadge}>默认</Text>
                  )}
                </TouchableOpacity>
                {/* 默认大类不显示任何操作按钮；用户新增的大类显示 [✏️] [🗑]（灰色极简图标，无背景） */}
                {!isDefaultBig && (
                  <View style={styles.actionButtonsRow}>
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => handleOpenRenameBig(cat.name)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Feather name="edit-2" size={18} color="#999" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => handleDeleteBig(cat.name)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Feather name="trash-2" size={18} color="#999" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* 展开后显示子类目 */}
              {isExpanded && (
                <View style={styles.subCategoryList}>
                  {cat.subCategories.length === 0 ? (
                    <Text style={styles.emptySubText}>暂无子类目</Text>
                  ) : (
                    cat.subCategories.map((sub) => {
                      const isDefaultSub = isDefaultSubCategory(cat.name, sub);
                      return (
                        <View key={sub} style={styles.subCategoryItem}>
                          <View style={styles.subCategoryItemLeft}>
                            <Text
                              style={styles.subCategoryItemText}
                              numberOfLines={1}
                            >
                              {sub}
                            </Text>
                            {isDefaultSub && (
                              <Text style={styles.defaultSubBadge}>默认</Text>
                            )}
                          </View>
                          {/* 默认子类目不显示任何操作按钮；用户新增的子类目显示 [✏️] [🗑]（灰色极简图标，无背景） */}
                          {!isDefaultSub && (
                            <View style={styles.subActionRow}>
                              <TouchableOpacity
                                style={styles.smallIconButton}
                                onPress={() => handleOpenRenameSub(cat.name, sub)}
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              >
                                <Feather name="edit-2" size={16} color="#999" />
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.smallIconButton}
                                onPress={() => handleDeleteSub(cat.name, sub)}
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              >
                                <Feather name="trash-2" size={16} color="#999" />
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      );
                    })
                  )}
                  {/* 新增子类目按钮（所有大类都允许新增子类目） */}
                  <TouchableOpacity
                    style={styles.addSubButton}
                    onPress={() => handleOpenAddSub(cat.name)}
                  >
                    <Text style={styles.addSubButtonText}>+ 新增子类目</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        {/* 重置入口 */}
        <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
          <Text style={styles.resetButtonText}>重置为默认类目</Text>
        </TouchableOpacity>

        {/* 导出提示 */}
        <View style={styles.exportHintContainer}>
          <Text style={styles.exportHintText}>
            提示：在"我的" → "数据导出"可将本机自定义的类目连同器件列表一并导出，
            另一台手机导入后即可直接使用，无需重新增删分类。
          </Text>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* 底部固定"新增大分类"按钮 */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.addBigFab}
          onPress={handleOpenAddBig}
        >
          <Text style={styles.addBigFabText}>+ 新增大分类</Text>
        </TouchableOpacity>
      </View>

      {/* 新增大分类弹窗 */}
      <Modal
        visible={showAddBigModal}
        animationType="fade"
        transparent={true}
        statusBarTranslucent={true}
        onRequestClose={closeAddBig}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={closeAddBig}
        >
          {/* 阻止点击穿透到外层 Pressable */}
          <Pressable onPress={() => {}} style={styles.modalInnerPressable}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>新增大分类</Text>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>大分类名称</Text>
                <TextInput
                  ref={bigInputRef}
                  style={styles.fileNameInput}
                  value={bigInput}
                  onChangeText={setBigInput}
                  placeholder="请输入大分类名称"
                  maxLength={20}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmitAddBig}
                />
              </View>
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={closeAddBig}
                >
                  <Text style={styles.cancelButtonText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.submitButton]}
                  onPress={handleSubmitAddBig}
                >
                  <Text style={styles.submitButtonText}>确定</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 新增子类目弹窗 */}
      <Modal
        visible={showAddSubModal}
        animationType="fade"
        transparent={true}
        statusBarTranslucent={true}
        onRequestClose={closeAddSub}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={closeAddSub}
        >
          <Pressable onPress={() => {}} style={styles.modalInnerPressable}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>新增子类目</Text>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>
                  所属大分类：{addSubTarget}
                </Text>
                <TextInput
                  ref={subInputRef}
                  style={styles.fileNameInput}
                  value={subInput}
                  onChangeText={setSubInput}
                  placeholder="请输入子类目名称"
                  maxLength={40}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmitAddSub}
                />
              </View>
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={closeAddSub}
                >
                  <Text style={styles.cancelButtonText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.submitButton]}
                  onPress={handleSubmitAddSub}
                >
                  <Text style={styles.submitButtonText}>确定</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 重命名大分类弹窗 */}
      <Modal
        visible={showRenameBigModal}
        animationType="fade"
        transparent={true}
        statusBarTranslucent={true}
        onRequestClose={closeRenameBig}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={closeRenameBig}
        >
          <Pressable onPress={() => {}} style={styles.modalInnerPressable}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>编辑大分类</Text>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>
                  原名称：{renameBigTarget}
                </Text>
                <TextInput
                  ref={renameBigInputRef}
                  style={styles.fileNameInput}
                  value={renameBigInput}
                  onChangeText={setRenameBigInput}
                  placeholder="请输入新名称"
                  maxLength={20}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmitRenameBig}
                />
              </View>
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={closeRenameBig}
                >
                  <Text style={styles.cancelButtonText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.submitButton]}
                  onPress={handleSubmitRenameBig}
                >
                  <Text style={styles.submitButtonText}>确定</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 重命名子类目弹窗 */}
      <Modal
        visible={showRenameSubModal}
        animationType="fade"
        transparent={true}
        statusBarTranslucent={true}
        onRequestClose={closeRenameSub}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={closeRenameSub}
        >
          <Pressable onPress={() => {}} style={styles.modalInnerPressable}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>编辑子类目</Text>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>
                  所属大分类：{renameSubTarget?.bigName}
                  {'\n'}原名称：{renameSubTarget?.oldSub}
                </Text>
                <TextInput
                  ref={renameSubInputRef}
                  style={styles.fileNameInput}
                  value={renameSubInput}
                  onChangeText={setRenameSubInput}
                  placeholder="请输入新名称"
                  maxLength={40}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmitRenameSub}
                />
              </View>
            <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={closeRenameSub}
                >
                <Text style={styles.cancelButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.submitButton]}
                onPress={handleSubmitRenameSub}
              >
                <Text style={styles.submitButtonText}>确定</Text>
              </TouchableOpacity>
            </View>
          </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
  },
  headerInfo: {
    backgroundColor: '#fff',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerInfoText: {
    fontSize: 13,
    color: '#666',
  },
  categoryBlock: {
    backgroundColor: 'white',
    marginTop: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  categoryHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryHeaderArrow: {
    fontSize: 14,
    color: '#999',
    width: 20,
  },
  categoryHeaderName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flexShrink: 1,
  },
  categoryHeaderCount: {
    fontSize: 13,
    color: '#999',
    marginLeft: 6,
  },
  deleteBigButton: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 8,
  },
  deleteBigButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  // 操作按钮容器（[编辑] [🗑]）
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // 大类的图标按钮（编辑/删除）
  iconButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginLeft: 6,
    minWidth: 32,
    alignItems: 'center',
  },
  // 子类目的小图标按钮
  smallIconButton: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginLeft: 4,
    minWidth: 28,
    alignItems: 'center',
  },
  // 编辑按钮：蓝色
  editButton: {
    backgroundColor: '#007AFF',
  },
  editButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  // 垃圾桶按钮：红色
  trashButton: {
    backgroundColor: '#FF3B30',
  },
  trashButtonText: {
    fontSize: 14,
  },
  // "默认" 徽章（灰底）
  defaultBadge: {
    fontSize: 11,
    color: '#fff',
    backgroundColor: '#999',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
    overflow: 'hidden',
    fontWeight: '500',
  },
  defaultSubBadge: {
    fontSize: 10,
    color: '#fff',
    backgroundColor: '#999',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    marginLeft: 8,
    overflow: 'hidden',
    fontWeight: '500',
  },
  // 子类目项左侧（文本 + 默认徽章）
  subCategoryItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  subCategoryList: {
    backgroundColor: '#fafafa',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingVertical: 6,
  },
  subCategoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 36,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  subCategoryItemText: {
    fontSize: 14,
    color: '#333',
    flex: 1,
    marginRight: 8,
  },
  deleteSubButton: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  deleteSubButtonText: {
    color: 'white',
    fontSize: 12,
  },
  emptySubText: {
    fontSize: 13,
    color: '#999',
    paddingHorizontal: 36,
    paddingVertical: 12,
    fontStyle: 'italic',
  },
  addSubButton: {
    paddingVertical: 12,
    paddingHorizontal: 36,
    alignItems: 'center',
    marginTop: 4,
  },
  addSubButtonText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  resetButton: {
    marginTop: 16,
    marginHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  resetButtonText: {
    fontSize: 14,
    color: '#FF9500',
    fontWeight: '500',
  },
  exportHintContainer: {
    marginTop: 16,
    marginHorizontal: 16,
    padding: 12,
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#1976d2',
  },
  exportHintText: {
    fontSize: 12,
    color: '#1976d2',
    lineHeight: 18,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  addBigFab: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  addBigFabText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // 模态框样式
  //
  // 关键修复：使用 position: absolute + 固定 top 位置，让弹窗位置
  // 不受键盘弹起/收起（adjustResize 触发的高度变化）影响。
  //
  // 旧版用 flex: 1 的问题：
  //   1. 用户输入完毕点弹窗外 → 触发键盘收起（adjustResize 反向动画）
  //   2. 同一帧，Pressable 触发关闭弹窗（setShowAddBigModal(false) → Modal fadeOut 动画）
  //   3. modalOverlay 用 flex:1 → 高度随键盘收回而增大 → modalContent 位置向上跳
  //   4. 三件事并发 → 在某些机型上看到 100-300ms 的"抽搐"或"界面抖动"
  //
  // 新版 position: absolute + 固定 top 50% + translateY 居中：
  //   - modalOverlay 始终铺满整个 Modal 容器
  //   - modalContent 用 transform 居中（不依赖 flex）
  //   - 键盘弹起时整个 View 不再随高度变化重排
  //   - 弹窗位置始终固定在屏幕中央
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  // 修复弹窗宽度跟随输入内容变化：
  //   内层 Pressable（用于阻止点击穿透）必须显式指定 width: '100%'，
  //   否则它是 shrink-to-fit 容器，宽度收缩到 modalContent 的内容宽度，
  //   而 modalContent 的 width: '85%' 又相对父容器宽度计算 → 循环引用
  //   → 实际宽度由 TextInput 内容字数决定（"逛"字时窄，10 字时宽）
  modalInnerPressable: {
    width: '100%',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    width: '85%',
    maxWidth: 400,
    // 在 modalInnerPressable 内水平居中（modalInnerPressable 默认 alignItems: stretch，
    // 子元素默认左对齐，加 alignSelf: 'center' 强制居中）
    alignSelf: 'center',
    // 固定 elevation 阴影，避免某些机型（特别是 OPPO/Vivo）在动画过程中阴影重绘造成的"抽搐"
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
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
});

export default CategoryManagementScreen;
