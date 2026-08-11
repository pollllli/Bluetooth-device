/**
 * 管理员编辑页面组件
 *
 * 功能说明：
 * - 新增器件上架
 * - 编辑已有器件信息
 * - 支持选择物理位置（蓝牙亮灯提示）
 * - 支持选择器件类目
 */
import React, { useState, useEffect, useReducer, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ToastAndroid,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import StorageService from '../services/StorageService';
import { logError, formatErrorMessage } from '../utils/ErrorHandler';
import { getCategories } from '../services/DeviceCategoryService';
import ImageUploadField from '../components/ImageUploadField';

const AdminEditScreen = ({ navigation, route }) => {
  // 获取路由参数：device（编辑时的器件数据）、isNew（是否新增）、onSave（保存回调）
  const { device, isNew, onSave } = route.params || {};

  /**
   * 表单初始状态
   *
   * id: 器件唯一标识（新增时为null）
   * supplierId: 供应商编号
   * name: 器件名称
   * brand: 采购渠道（原品牌字段，扫码时手动输入）
   * category: 器件类目
   * package: 封装形式
   * quantity: 数量
   * location: 物理位置（0-239）
   * notes: 备注说明
   * shelfId: 器件架编号（默认1）
   * errors: 表单验证错误信息
   */
  const initialState = {
    id: device?.id || null,
    supplierId: device?.supplierId || '',
    name: device?.name || '',
    brand: device?.brand || '',
    category: device?.category || '',
    package: device?.package || '',
    quantity: device?.quantity != null ? String(device.quantity) : '1',
    location: device?.location != null && device?.location !== '' ? String(device.location) : '',
    notes: device?.notes || '',
    shelfId: device?.shelfId ? device.shelfId.toString() : '1',
    image: device?.image || '',  // 已存的图片 uri（编辑时回显）
    errors: {},
  };

  const reducer = (state, action) => {
    switch (action.type) {
      case 'SET_FIELD':
        return {
          ...state,
          [action.payload.field]: action.payload.value,
          errors: {
            ...state.errors,
            [action.payload.field]: '',
          },
        };
      case 'SET_ERRORS':
        return {
          ...state,
          errors: action.payload,
        };
      case 'RESET':
        return initialState;
      default:
        return state;
    }
  };

  const [state, dispatch] = useReducer(reducer, initialState);
  const [isLoading, setIsLoading] = useState(false);
  const [showPositionPicker, setShowPositionPicker] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [allDevices, setAllDevices] = useState([]);
  const [expandedBank, setExpandedBank] = useState(null);
  const [expandedCategory, setExpandedCategory] = useState(null);
  // 器件类目数据（从存储加载，支持用户在"分类管理"页增删）
  const [categories, setCategories] = useState([]);
  // 类目搜索关键词
  const [categorySearchQuery, setCategorySearchQuery] = useState('');
  const currentLitPosition = useRef(null);
  const previewTimeout = useRef(null);

  const sendLightCommand = async (type, position) => {
    if (!global.deviceConnection || !global.deviceConnection.handler) {
      return { success: false, message: '未连接蓝牙' };
    }
    try {
      // sendCommand 返回 { success, message }, true=下位机接受命令, false=BLE 失败
      const result = await global.deviceConnection.handler.sendCommand({ type, lightId: position });
      return result || { success: true };  // 没返回值视为成功
    } catch (error) {
      console.log('灯光指令发送失败:', error);
      return { success: false, message: error?.message || '发送失败' };
    }
  };

  /**
   * 显示一行文字提示 (无弹窗, 用 Toast / 内嵌条, 1.5s 后自动消失)
   * 给"下位机无响应"场景用, 区别于"请用户做选择"的 Alert.alert
   */
  const showHint = (message) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      // iOS / 其他: 兜底用 Alert, 但 iOS 实际不会触发此分支 (主要平台是 Android)
      Alert.alert('提示', message);
    }
  };

  const turnOffCurrentLight = async () => {
    // 清除预览定时器
    if (previewTimeout.current) {
      clearTimeout(previewTimeout.current);
      previewTimeout.current = null;
    }
    // 熄灭灯光
    if (currentLitPosition.current !== null) {
      await sendLightCommand('lightOff', currentLitPosition.current);
      currentLitPosition.current = null;
    }
  };

  /**
   * 打开类目选择器：默认展开当前类目所在的大类
   */
  const handleOpenCategoryPicker = async () => {
    // 重新加载类目，保证拿到最新数据
    const list = await getCategories();
    setCategories(list);
    const currentCat = state.category || '';
    let matchedIndex = null;
    if (currentCat) {
      matchedIndex = list.findIndex(c =>
        c.name === currentCat || (c.subCategories || []).includes(currentCat)
      );
    }
    setExpandedCategory(matchedIndex >= 0 ? matchedIndex : null);
    setShowCategoryPicker(true);
  };

  /**
   * 选择具体小类目后，更新表单的类目字段
   */
  const handleSelectCategory = (subCategory) => {
    dispatch({
      type: 'SET_FIELD',
      payload: { field: 'category', value: subCategory },
    });
    setShowCategoryPicker(false);
    setExpandedCategory(null);
  };

  // 图片选择交给 ImageUploadField 组件处理, 这里只需 state 回调
  const handleImageChange = useCallback(
    (uri) => {
      dispatch({ type: 'SET_FIELD', payload: { field: 'image', value: uri } });
    },
    []
  );

  useFocusEffect(
    React.useCallback(() => {
      const loadAllDevices = async () => {
        const devices = await StorageService.getDevices();
        setAllDevices(devices);
      };
      const loadCategoriesData = async () => {
        try {
          const list = await getCategories();
          setCategories(list);
        } catch (error) {
          console.log('加载类目失败:', error);
        }
      };
      loadAllDevices();
      loadCategoriesData();
      return () => {
        turnOffCurrentLight();
      };
    }, [])
  );

  const getOccupiedPositions = () => {
    const occupied = new Map();
    // 多库存: 用当前编辑器件的 shelfId (而不是写死 '1'), 避免位置冲突检查错乱
    const editingShelfId = state.shelfId || '1';
    allDevices
      .filter((d) => d.shelfId === editingShelfId && d.location != null && d.location !== '' && d.id !== state.id)
      .forEach((d) => {
        const pos = parseInt(d.location, 10);
        if (!isNaN(pos)) {
          occupied.set(pos, d.name || '未知');
        }
      });
    return occupied;
  };

  const getAllPositions = () => {
    const occupied = getOccupiedPositions();
    const positions = [];
    // 300 位置 (10 排 × 30) = 单库存容量上限, 跟 utils/positionUtils.DEFAULT_MAX 同步
    for (let i = 0; i < 300; i++) {
      positions.push({
        position: i,
        isOccupied: occupied.has(i),
        deviceName: occupied.get(i) || '',
      });
    }
    return positions;
  };

  const validateForm = () => {
    const errors = {};

    if (!state.name.trim() && !state.supplierId.trim()) {
      errors.name = '器件名称和供应商编号至少填写一项';
    }

    return errors;
  };

  const handleSave = async () => {
    const errors = validateForm();

    if (Object.keys(errors).length > 0) {
      dispatch({ type: 'SET_ERRORS', payload: errors });
      Alert.alert('错误', '请检查表单填写是否正确');
      return;
    }

    setIsLoading(true);
    try {
      const deviceData = {
        ...state,
        id: state.id || Date.now(),
        quantity: parseInt(state.quantity) || 1,
      };

      let savedDevice;
      if (isNew) {
        try {
          savedDevice = await StorageService.addDevice(deviceData);
          Alert.alert('成功', '器件上架成功');
        } catch (error) {
          if (error.message && error.message.includes('冲突')) {
            Alert.alert('错误', error.message);
            return;
          } else {
            throw error;
          }
        }
      } else {
        try {
          savedDevice = await StorageService.updateDevice(deviceData);
          Alert.alert('成功', '器件更新成功');
        } catch (error) {
          if (error.message && error.message.includes('冲突')) {
            Alert.alert('错误', error.message);
            return;
          } else {
            throw error;
          }
        }
      }

      if (onSave) {
        onSave(savedDevice);
      }

      navigation.goBack();
    } catch (error) {
      logError('保存器件失败', error, 'AdminEditScreen.handleSave');
      Alert.alert('错误', '保存器件失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={true}>
        <View style={styles.formContainer}>
          {isNew && (
            <View style={styles.importButtonContainer}>
              <TouchableOpacity
                style={[styles.importButton, styles.scanButton]}
                onPress={() => navigation.navigate('ScanScreen')}
              >
                <Text style={styles.importButtonText}>扫码导入</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>基本信息</Text>

            {/* 1. 编号 + 添加图片 (50:50) */}
            <View style={styles.formGroup}>
              <View style={styles.row}>
                {/* 编号 - 50% */}
                <View style={styles.halfWidth}>
                  <Text style={styles.label}>编号</Text>
                  <TextInput
                    style={styles.input}
                    value={state.supplierId}
                    onChangeText={(text) =>
                      dispatch({
                        type: 'SET_FIELD',
                        payload: { field: 'supplierId', value: text },
                      })
                    }
                    placeholder="请输入编号"
                  />
                </View>
                {/* 添加图片 - 50%, 高度比编号框稍长 */}
                <View style={styles.halfWidth}>
                  <ImageUploadField
                    value={state.image}
                    onChange={handleImageChange}
                    label="图片"
                    height={80}
                  />
                </View>
              </View>
            </View>

            {/* 2. 名称 */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>名称 *</Text>
              <TextInput
                style={[styles.input, state.errors.name && styles.inputError]}
                value={state.name}
                onChangeText={(text) =>
                  dispatch({
                    type: 'SET_FIELD',
                    payload: { field: 'name', value: text },
                  })
                }
                placeholder="请输入名称"
              />
              {state.errors.name && (
                <Text style={styles.errorText}>{state.errors.name}</Text>
              )}
            </View>

            {/* 3. 类目（手动选择，爬虫已关闭但类目选择器仍可用） */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>类目</Text>
              <TouchableOpacity
                style={styles.positionButton}
                onPress={handleOpenCategoryPicker}
              >
                <Text style={styles.positionButtonText} numberOfLines={1}>
                  {state.category ? state.category : '点击选择类目'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* 4. 数量 */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>数量</Text>
              <TextInput
                style={styles.input}
                value={state.quantity}
                onChangeText={(text) =>
                  dispatch({
                    type: 'SET_FIELD',
                    payload: { field: 'quantity', value: text.replace(/[^0-9]/g, '') },
                  })
                }
                placeholder="请输入数量"
                keyboardType="number-pad"
              />
            </View>

            {/* 5. 位置 */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>位置</Text>
              <TouchableOpacity
                style={styles.positionButton}
                onPress={() => {
                  if (!global.deviceConnection) {
                    Alert.alert('提示', '选择位置需要连接蓝牙设备以亮灯提示位置，请先在连接页面连接蓝牙设备');
                    return;
                  }
                  setShowPositionPicker(true);
                }}
              >
                <Text style={styles.positionButtonText}>
                  {state.location != null && state.location !== '' ? `位置 ${state.location}` : '点击选择位置'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* 6. 备注 */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>备注</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={state.notes}
                onChangeText={(text) =>
                  dispatch({
                    type: 'SET_FIELD',
                    payload: { field: 'notes', value: text },
                  })
                }
                placeholder="请输入备注"
                multiline
                numberOfLines={3}
              />
            </View>

            {/* 7. 采购渠道（原"品牌"字段，扫码时手动输入，此处可查看/修改） */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>采购渠道</Text>
              <TextInput
                style={styles.input}
                value={state.brand}
                onChangeText={(text) =>
                  dispatch({
                    type: 'SET_FIELD',
                    payload: { field: 'brand', value: text },
                  })
                }
                placeholder="如：立创商城 / 淘宝 / 自有库存..."
              />
            </View>

            {/* 8. 封装（可选辅助字段） */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>封装</Text>
              <TextInput
                style={styles.input}
                value={state.package}
                onChangeText={(text) =>
                  dispatch({
                    type: 'SET_FIELD',
                    payload: { field: 'package', value: text },
                  })
                }
                placeholder="请输入封装"
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.saveButton, isLoading && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={isLoading}
          >
            <Text style={styles.saveButtonText}>
              {isLoading ? '保存中...' : isNew ? '上架器件' : '更新器件'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal
        visible={showPositionPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          turnOffCurrentLight();
          setShowPositionPicker(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>选择物理位置</Text>
            <ScrollView style={styles.positionGrid}>
              {Array.from({ length: 10 }, (_, bankIndex) => (
                <View key={bankIndex}>
                  <TouchableOpacity
                    style={styles.positionBankHeader}
                    onPress={() => setExpandedBank(expandedBank === bankIndex ? null : bankIndex)}
                  >
                    <Text style={styles.positionBankHeaderText}>
                      第{bankIndex + 1}排（位置 {bankIndex * 30}-{bankIndex * 30 + 29}）
                    </Text>
                    <Text style={styles.positionBankHeaderArrow}>
                      {expandedBank === bankIndex ? '▲' : '▼'}
                    </Text>
                  </TouchableOpacity>
                  {expandedBank === bankIndex && (
                    <View style={styles.positionGridInner}>
                      {getAllPositions()
                        .slice(bankIndex * 30, (bankIndex + 1) * 30)
                        .map((posInfo) => {
                          const isCurrentPosition = state.location === String(posInfo.position);
                          return (
                            <TouchableOpacity
                              key={posInfo.position}
                              style={[
                                styles.positionItem,
                                posInfo.isOccupied ? styles.positionItemOccupied : styles.positionItemEmpty,
                                isCurrentPosition && styles.positionItemCurrent,
                              ]}
                              onPress={async () => {
                                if (posInfo.isOccupied && !isCurrentPosition) return;
                                // 选位置流程 (无弹窗版):
                                //   1. 没连蓝牙 → 直接保存 (用户可能没连下位机也想存位置)
                                //   2. 连了蓝牙 → 发"亮灯"命令试亮
                                //      · 试亮成功 → 直接保存, 啥都不弹 (用户能直接看到灯亮)
                                //      · 试亮失败 (BLE 写失败 / 下位机不响应) → 弹"该位置不可存, 请更换"
                                // 这样:
                                //   · 下位机有灯, 灯亮 → 一键入库, 不打扰
                                //   · 下位机无对应灯, BLE 写不进去 → 友好提示
                                //   · 不在代码里硬编码硬件上限, 任何下位机都不用改代码
                                if (!global.deviceConnection || !global.deviceConnection.handler) {
                                  // 没连蓝牙: 直接保存, 不打扰用户
                                  dispatch({
                                    type: 'SET_FIELD',
                                    payload: { field: 'location', value: String(posInfo.position) },
                                  });
                                  setShowPositionPicker(false);
                                  return;
                                }

                                // 有蓝牙: 先试亮
                                if (currentLitPosition.current !== null) {
                                  try {
                                    await sendLightCommand('lightOff', currentLitPosition.current);
                                  } catch (e) { /* ignore */ }
                                  await new Promise(resolve => setTimeout(resolve, 200));
                                }
                                const result = await sendLightCommand('lightOn', posInfo.position);

                                if (!result || result.success === false) {
                                  // 下位机无响应 → Toast 文字提示 (无弹窗, 1.5s 自动消失)
                                  // 用户继续在位置选择器里操作
                                  showHint(`位置 ${posInfo.position} 不可存, 请更换`);
                                  return;
                                }

                                // 试亮成功 → 直接入库, 不弹任何提示
                                currentLitPosition.current = posInfo.position;
                                dispatch({
                                  type: 'SET_FIELD',
                                  payload: { field: 'location', value: String(posInfo.position) },
                                });
                                setShowPositionPicker(false);
                              }}
                              onLongPress={async () => {
                                if (posInfo.isOccupied && !isCurrentPosition) return;
                                // 长按只是预览, 不弹确认 (避免长按也弹窗干扰用户)
                                // 用户最终点 onPress 才会存, 那时再弹确认
                                if (!global.deviceConnection || !global.deviceConnection.handler) return;
                                if (global.deviceConnection && global.deviceConnection.handler) {
                                  // 清除之前的自动熄灭定时器
                                  if (previewTimeout.current) {
                                    clearTimeout(previewTimeout.current);
                                  }
                                  // 关闭之前亮的灯
                                  if (currentLitPosition.current !== null) {
                                    await sendLightCommand('lightOff', currentLitPosition.current);
                                    await new Promise(resolve => setTimeout(resolve, 300));
                                  }
                                  // 点亮新位置的灯
                                  await sendLightCommand('lightOn', posInfo.position);
                                  currentLitPosition.current = posInfo.position;
                                  // 1.5秒后自动熄灭预览灯
                                  previewTimeout.current = setTimeout(async () => {
                                    if (currentLitPosition.current === posInfo.position) {
                                      await sendLightCommand('lightOff', posInfo.position);
                                      currentLitPosition.current = null;
                                    }
                                    previewTimeout.current = null;
                                  }, 1500);
                                }
                              }}
                              activeOpacity={posInfo.isOccupied && !isCurrentPosition ? 1 : 0.7}
                            >
                              <Text
                                style={[
                                  styles.positionItemText,
                                  posInfo.isOccupied ? styles.positionItemTextOccupied : styles.positionItemTextEmpty,
                                  isCurrentPosition && styles.positionItemTextCurrent,
                                ]}
                              >
                                {posInfo.position}
                              </Text>
                              {isCurrentPosition && (
                                <Text style={styles.positionItemCurrentLabel} numberOfLines={1}>
                                  当前
                                </Text>
                              )}
                            </TouchableOpacity>
                          );
                        })}
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => {
                turnOffCurrentLight();
                setShowPositionPicker(false);
              }}
            >
              <Text style={styles.modalCancelButtonText}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 类目选择弹窗：40个大类，每个大类可展开/折叠小类目，点击小类目确认 */}
      <Modal
        visible={showCategoryPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setExpandedCategory(null);
          setShowCategoryPicker(false);
          setCategorySearchQuery('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>选择器件类目</Text>
            {/* 搜索框 */}
            <TextInput
              style={styles.categorySearchInput}
              placeholder="搜索类目..."
              value={categorySearchQuery}
              onChangeText={setCategorySearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {/* 显示当前已选类目 */}
            {state.category ? (
              <Text style={styles.categoryCurrentLabel}>当前：{state.category}</Text>
            ) : null}
            {/* 类目网格：所有大类，点击展开/折叠显示小类目 */}
            <ScrollView style={styles.positionGrid}>
              {(() => {
                if (categorySearchQuery.trim()) {
                  const query = categorySearchQuery.toLowerCase().trim();
                  const matchedSubs = [];
                  categories.forEach((cat) => {
                    cat.subCategories.forEach((sub) => {
                      if (sub.toLowerCase().includes(query)) {
                        matchedSubs.push({ big: cat.name, sub });
                      }
                    });
                  });
                  if (matchedSubs.length > 0) {
                    return (
                      <View style={styles.searchResultList}>
                        {matchedSubs.map((item, idx) => (
                          <TouchableOpacity
                            key={idx}
                            style={styles.subCategoryItem}
                            onPress={() => handleSelectCategory(item.sub)}
                          >
                            <Text style={styles.subCategoryItemText} numberOfLines={1}>
                              {item.sub}
                            </Text>
                            <Text style={styles.subCategoryItemBig}>
                              {item.big}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    );
                  } else {
                    return (
                      <Text style={styles.searchEmptyText}>
                        未找到匹配的类目
                      </Text>
                    );
                  }
                }
                return categories.map((cat, idx) => (
                  <View key={cat.name}>
                    <TouchableOpacity
                      style={styles.positionBankHeader}
                      onPress={() => setExpandedCategory(expandedCategory === idx ? null : idx)}
                    >
                      <Text style={styles.positionBankHeaderText}>
                        {cat.name}（{cat.subCategories.length}项）
                      </Text>
                      <Text style={styles.positionBankHeaderArrow}>
                        {expandedCategory === idx ? '▲' : '▼'}
                      </Text>
                    </TouchableOpacity>
                    {expandedCategory === idx && (
                      <View style={styles.subCategoryList}>
                        {cat.subCategories.map((sub) => (
                          <TouchableOpacity
                            key={sub}
                            style={styles.subCategoryItem}
                            onPress={() => handleSelectCategory(sub)}
                          >
                            <Text style={styles.subCategoryItemText} numberOfLines={1}>{sub}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                ));
              })()}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => {
                setExpandedCategory(null);
                setShowCategoryPicker(false);
                setCategorySearchQuery('');
              }}
            >
              <Text style={styles.modalCancelButtonText}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  scrollView: {
    flex: 1,
  },
  formContainer: {
    padding: 20,
  },
  importButtonContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  section: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    paddingBottom: 8,
  },
  formGroup: {
    marginBottom: 16,
  },
  halfWidth: {
    width: '48%',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 16,
  },
  inputError: {
    borderColor: '#ff3b30',
  },
  // 添加图片方框 (朋友圈风格: 浅灰底 + 灰色加号)
  imageUploadBox: {
    height: 80,  // 比 TextInput 稍高 (用户最初要求: 比编号输入框长一点)
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',  // 虚线边框, 更像上传框
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageUploadPlus: {
    fontSize: 40,
    fontWeight: '300',
    color: '#999',
    lineHeight: 40,
    includeFontPadding: false,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  errorText: {
    color: '#ff3b30',
    fontSize: 12,
    marginTop: 4,
  },
  saveButton: {
    backgroundColor: '#4caf50',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  shelfSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  shelfSelectorSingle: {
    backgroundColor: '#4caf50',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4caf50',
    alignItems: 'center',
  },
  shelfOption: {
    flex: 1,
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  shelfOptionSelected: {
    backgroundColor: '#4caf50',
    borderColor: '#4caf50',
  },
  shelfOptionText: {
    fontSize: 14,
    color: '#333',
  },
  shelfOptionTextSelected: {
    color: 'white',
    fontWeight: '600',
  },
  importButton: {
    flex: 1,
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  scanButton: {
    backgroundColor: '#ff9800',
  },
  importButtonDisabled: {
    opacity: 0.5,
  },
  importButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  positionButton: {
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  positionButtonText: {
    fontSize: 16,
    color: '#333',
  },
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
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  positionGrid: {
    maxHeight: 350,
  },
  positionBankHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 6,
    marginTop: 4,
  },
  positionBankHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  positionBankHeaderArrow: {
    fontSize: 12,
    color: '#666',
  },
  positionGridInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  positionItem: {
    width: '18%',
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
    marginHorizontal: '1%',
    marginBottom: 6,
    borderWidth: 1,
  },
  positionItemEmpty: {
    backgroundColor: '#e3f2fd',
    borderColor: '#bbdefb',
  },
  positionItemOccupied: {
    backgroundColor: '#e8f5e9',
    borderColor: '#a5d6a7',
  },
  positionItemCurrent: {
    backgroundColor: '#fff3e0',
    borderColor: '#ffcc80',
    borderWidth: 2,
  },
  positionItemText: {
    fontSize: 16,
    fontWeight: '600',
  },
  positionItemTextEmpty: {
    color: '#1976d2',
  },
  positionItemTextOccupied: {
    color: '#2e7d32',
  },
  positionItemTextCurrent: {
    color: '#e65100',
  },
  positionItemDeviceName: {
    fontSize: 8,
    color: '#4caf50',
    marginTop: 1,
  },
  positionItemCurrentLabel: {
    fontSize: 8,
    color: '#ff9800',
    marginTop: 1,
  },

  /* ===== 类目选择弹窗样式 ===== */
  categoryCurrentLabel: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#fff3e0',
    borderRadius: 6,
  },
  subCategoryList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  subCategoryItem: {
    width: '48%',
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginHorizontal: '1%',
    marginBottom: 6,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    borderWidth: 0,
    alignItems: 'center',
  },
  subCategoryItemText: {
    fontSize: 13,
    color: '#333',
    textAlign: 'center',
  },
  subCategoryItemBig: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  categorySearchInput: {
    width: '100%',
    height: 40,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 12,
  },
  searchResultList: {
    paddingVertical: 4,
  },
  searchEmptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 20,
  },
  modalCancelButton: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#8E8E93',
    alignItems: 'center',
  },
  modalCancelButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default AdminEditScreen;