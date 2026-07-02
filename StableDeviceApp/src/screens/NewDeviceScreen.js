/**
 * 新建器件页面组件（无二维码器件入库）
 *
 * 功能说明：
 * - 适用于没有二维码、需手工填入信息的器件
 * - 器件编号自动生成：H + 年份(2) + 月日(4) + 首次存放位置(3位补零)
 *   例如 2026-06-23 存入 99 位置 → H260623099
 * - 不包含电气参数字段（电阻/电压/电容/电感/电流/功率/频率）
 * - 字段参考 AdminEditScreen（器件编辑页）但已精简
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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import StorageService from '../services/StorageService';
import ShelfService from '../services/ShelfService';
import { logError } from '../utils/ErrorHandler';
import { getCategories } from '../services/DeviceCategoryService';
import { findFirstEmptyPosition, getOccupiedPositionMap } from '../utils/positionUtils';
import ImageUploadField from '../components/ImageUploadField';

const NewDeviceScreen = ({ navigation, route }) => {
  const { onSave } = route.params || {};

  /**
   * 表单初始状态
   * supplierId 由选中位置后自动生成，初始为空
   */
  const initialState = {
    supplierId: '',
    name: '',
    category: '',
    package: '',
    quantity: '1',
    location: '',
    notes: '',
    brand: '',
    image: '',          // 器件图片 uri (expo-image-picker 选完回调写入)
    shelfId: '1',       // 默认占位, 真实保存时由 handleSave 覆盖为当前选中库存
    errors: {},
  };

  const reducer = (state, action) => {
    switch (action.type) {
      case 'SET_FIELD':
        return {
          ...state,
          [action.payload.field]: action.payload.value,
          errors: { ...state.errors, [action.payload.field]: '' },
        };
      case 'SET_FIELDS':
        return {
          ...state,
          ...action.payload,
          errors: Object.keys(action.payload).reduce(
            (acc, k) => ({ ...acc, [k]: '' }),
            { ...state.errors }
          ),
        };
      case 'SET_ERRORS':
        return { ...state, errors: action.payload };
      default:
        return state;
    }
  };

  const [state, dispatch] = useReducer(reducer, initialState);
  const [isLoading, setIsLoading] = useState(false);
  const [showPositionPicker, setShowPositionPicker] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [allDevices, setAllDevices] = useState([]);
  // 标记 allDevices 是否已加载完成 (区分"加载中"和"加载完但空架")
  // 不加这个 flag 的话, 空架时 allDevices.length === 0 永远 return, useEffect 永远不触发
  const [allDevicesLoaded, setAllDevicesLoaded] = useState(false);
  const [expandedBank, setExpandedBank] = useState(null);
  const [categories, setCategories] = useState([]);
  const [categorySearchQuery, setCategorySearchQuery] = useState('');
  const [expandedCategory, setExpandedCategory] = useState(null);
  const currentLitPosition = useRef(null);
  const previewTimeout = useRef(null);

  // 图片选择交给 ImageUploadField 组件处理, 这里只需 state 回调
  const handleImageChange = useCallback((uri) => {
    dispatch({ type: 'SET_FIELD', payload: { field: 'image', value: uri } });
  }, []);

  /**
   * 生成器件编号
   * 格式：H + 年份(后2位) + MMDD + 位置(3位补零)
   */
  const generateSupplierId = (position) => {
    const now = new Date();
    const year = String(now.getFullYear()).slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const pos = String(parseInt(position, 10)).padStart(3, '0');
    return `H${year}${month}${day}${pos}`;
  };

  const sendLightCommand = async (type, position) => {
    if (!global.deviceConnection || !global.deviceConnection.handler) return;
    try {
      await global.deviceConnection.handler.sendCommand({ type, lightId: position });
    } catch (error) {
      console.log('灯光指令发送失败:', error);
    }
  };

  const turnOffCurrentLight = async () => {
    if (previewTimeout.current) {
      clearTimeout(previewTimeout.current);
      previewTimeout.current = null;
    }
    if (currentLitPosition.current !== null) {
      await sendLightCommand('lightOff', currentLitPosition.current);
      currentLitPosition.current = null;
    }
  };

  const handleOpenCategoryPicker = async () => {
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

  const handleSelectCategory = (subCategory) => {
    dispatch({ type: 'SET_FIELD', payload: { field: 'category', value: subCategory } });
    setShowCategoryPicker(false);
    setExpandedCategory(null);
  };

  useFocusEffect(
    React.useCallback(() => {
      const loadAllDevices = async () => {
        const devices = await StorageService.getDevices();
        setAllDevices(devices);
        setAllDevicesLoaded(true);  // 标记加载完成 (即使 devices 是空数组)
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

  const getAllPositions = async () => {
    const shelfId = await ShelfService.getCurrentShelfId();
    const occupied = await getOccupiedPositionMap(allDevices, shelfId);
    const positions = [];
    for (let i = 0; i < 240; i++) {
      positions.push({
        position: i,
        isOccupied: occupied.has(i),
        deviceName: occupied.get(i) || '',
      });
    }
    return positions;
  };

  /**
   * 自动填充第一个空位置（与扫码上架一致）:
   * - 仅在 allDevices 加载完后生效
   * - 优先查找 0-89 范围
   * - 找到后同步生成 supplierId
   * - 满架则保持 location 空,让用户手动选择
   */
  useEffect(() => {
    (async () => {
      if (!allDevicesLoaded) return;             // 还在加载, 跳过
      if (state.location) return;                // 用户已选, 跳过
      const shelfId = await ShelfService.getCurrentShelfId();
      const empty = findFirstEmptyPosition(allDevices, shelfId, 90);
      if (empty == null) return;                 // 满架, 保持空让用户选
      // 自动分配第一个空位 + 自动生成编号
      const newSupplierId = generateSupplierId(empty);
      dispatch({
        type: 'SET_FIELDS',
        payload: { location: empty, supplierId: newSupplierId },
      });
      // 关键: 找到空位后, 立即亮灯提示用户这个位置将被分配
      if (global.deviceConnection && global.deviceConnection.handler) {
        sendLightCommand('lightOn', empty);
        currentLitPosition.current = empty;
      }
    })();
  }, [allDevicesLoaded, allDevices, state.location]);

  /**
   * 选中位置后：更新位置 + 自动生成 supplierId
   */
  const handleSelectPosition = async (position) => {
    const supplierId = generateSupplierId(position);
    dispatch({
      type: 'SET_FIELDS',
      payload: { location: String(position), supplierId },
    });

    // 亮灯提示新位置
    if (global.deviceConnection && global.deviceConnection.handler) {
      if (currentLitPosition.current !== null) {
        await sendLightCommand('lightOff', currentLitPosition.current);
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      await sendLightCommand('lightOn', position);
      currentLitPosition.current = position;
    }
    setShowPositionPicker(false);
  };

  const handlePositionPreview = async (posInfo) => {
    if (posInfo.isOccupied) return;
    if (previewTimeout.current) {
      clearTimeout(previewTimeout.current);
    }
    if (currentLitPosition.current !== null) {
      await sendLightCommand('lightOff', currentLitPosition.current);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    await sendLightCommand('lightOn', posInfo.position);
    currentLitPosition.current = posInfo.position;
    previewTimeout.current = setTimeout(async () => {
      if (currentLitPosition.current === posInfo.position) {
        await sendLightCommand('lightOff', posInfo.position);
        currentLitPosition.current = null;
      }
      previewTimeout.current = null;
    }, 1500);
  };

  const validateForm = () => {
    const errors = {};
    if (!state.name.trim()) {
      errors.name = '请输入器件名称';
    }
    // 位置不是必填项:
    //   - 用户没选时, useEffect 会自动分配第一个空位(并亮灯提示)
    //   - 满架时 location 留空, 让用户手动选位
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
      // 兜底: 如果 useEffect 没跑成功 (如 allDevices 异步加载慢, 用户秒保存),
      //       或用户手动选过位置但 supplierId 丢失, 这里用 state.location 重新生成
      const finalLocation = state.location || (() => {
        // 极端情况: 连位置都没自动分配 (满架 or 异步未就绪)
        // 这里不强行分配, 交给上层的"未选位置"提示
        return '';
      })();
      const finalSupplierId = state.supplierId
        || (finalLocation ? generateSupplierId(finalLocation) : '');
      // 多库存: 器件归属当前选中库存
      const currentShelfId = await ShelfService.getCurrentShelfId();
      const deviceData = {
        id: Date.now(),
        supplierId: finalSupplierId,
        name: state.name.trim(),
        category: state.category,
        package: state.package.trim(),
        quantity: parseInt(state.quantity) || 1,
        location: finalLocation,
        notes: state.notes.trim(),
        brand: state.brand.trim(),
        shelfId: currentShelfId,
        image: state.image || '',          // 图片 uri (来自 expo-image-picker)
      };

      let savedDevice;
      try {
        savedDevice = await StorageService.addDevice(deviceData);
      } catch (error) {
        if (error.message && error.message.includes('冲突')) {
          Alert.alert('错误', error.message);
          return;
        }
        throw error;
      }

      // 熄灭灯光
      await turnOffCurrentLight();

      if (onSave) onSave(savedDevice);

      Alert.alert('成功', `器件入库成功\n编号：${state.supplierId}`, [
        { text: '确定', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      logError('新建器件失败', error, 'NewDeviceScreen.handleSave');
      Alert.alert('错误', '新建器件失败，请重试');
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
          <View style={styles.hintBox}>
            <Text style={styles.hintText}>
              适用于没有二维码的器件入库。{'\n'}
              编号将根据您选择的存放位置自动生成。
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>基本信息</Text>

            {/* 1. 编号（只读，自动生成） + 添加图片 (50:50) */}
            <View style={styles.formGroup}>
              <View style={styles.row}>
                {/* 编号 - 50% (只读自动生成) */}
                <View style={styles.halfWidth}>
                  <Text style={styles.label}>编号（自动生成）</Text>
                  <View style={styles.supplierIdBox}>
                    <Text
                      style={[
                        styles.supplierIdText,
                        !state.supplierId && styles.supplierIdPlaceholder,
                      ]}
                      numberOfLines={1}
                    >
                      {state.supplierId || 'H + 日期 + 位置'}
                    </Text>
                  </View>
                </View>
                {/* 添加图片 - 50% */}
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
                  dispatch({ type: 'SET_FIELD', payload: { field: 'name', value: text } })
                }
                placeholder="请输入器件名称"
              />
              {state.errors.name && (
                <Text style={styles.errorText}>{state.errors.name}</Text>
              )}
            </View>

            {/* 3. 类目 */}
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

            {/* 5. 位置（不是必填, 不选时自动分配第一个空位并亮灯） */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>位置</Text>
              <TouchableOpacity
                style={styles.positionButton}
                onPress={() => {
                  if (!global.deviceConnection) {
                    Alert.alert(
                      '提示',
                      '选择位置需要连接蓝牙设备以亮灯提示位置，请先在连接页面连接蓝牙设备'
                    );
                    return;
                  }
                  setShowPositionPicker(true);
                }}
              >
                <Text style={styles.positionButtonText}>
                  {state.location != null && state.location !== ''
                    ? `位置 ${state.location}`
                    : '点击选择位置'}
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
                  dispatch({ type: 'SET_FIELD', payload: { field: 'notes', value: text } })
                }
                placeholder="请输入备注"
                multiline
                numberOfLines={3}
              />
            </View>

            {/* 7. 采购渠道 */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>采购渠道</Text>
              <TextInput
                style={styles.input}
                value={state.brand}
                onChangeText={(text) =>
                  dispatch({ type: 'SET_FIELD', payload: { field: 'brand', value: text } })
                }
                placeholder="如：立创商城 / 淘宝 / 自有库存..."
              />
            </View>

            {/* 8. 封装 */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>封装</Text>
              <TextInput
                style={styles.input}
                value={state.package}
                onChangeText={(text) =>
                  dispatch({ type: 'SET_FIELD', payload: { field: 'package', value: text } })
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
              {isLoading ? '入库中...' : '入库器件'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* 位置选择弹窗 */}
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
            <Text style={styles.modalTitle}>选择存放位置</Text>
            <ScrollView style={styles.positionGrid}>
              {Array.from({ length: 8 }, (_, bankIndex) => (
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
                          const isCurrent = state.location === String(posInfo.position);
                          return (
                            <TouchableOpacity
                              key={posInfo.position}
                              style={[
                                styles.positionItem,
                                posInfo.isOccupied
                                  ? styles.positionItemOccupied
                                  : styles.positionItemEmpty,
                                isCurrent && styles.positionItemCurrent,
                              ]}
                              onPress={() => {
                                if (posInfo.isOccupied && !isCurrent) return;
                                handleSelectPosition(posInfo.position);
                              }}
                              onLongPress={() => handlePositionPreview(posInfo)}
                              activeOpacity={posInfo.isOccupied && !isCurrent ? 1 : 0.7}
                            >
                              <Text
                                style={[
                                  styles.positionItemText,
                                  posInfo.isOccupied
                                    ? styles.positionItemTextOccupied
                                    : styles.positionItemTextEmpty,
                                  isCurrent && styles.positionItemTextCurrent,
                                ]}
                              >
                                {posInfo.position}
                              </Text>
                              {isCurrent && (
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

      {/* 类目选择弹窗 */}
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
            <TextInput
              style={styles.categorySearchInput}
              placeholder="搜索类目..."
              value={categorySearchQuery}
              onChangeText={setCategorySearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {state.category ? (
              <Text style={styles.categoryCurrentLabel}>当前：{state.category}</Text>
            ) : null}
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
                            <Text style={styles.subCategoryItemBig}>{item.big}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    );
                  }
                  return <Text style={styles.searchEmptyText}>未找到匹配的类目</Text>;
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
                            <Text style={styles.subCategoryItemText} numberOfLines={1}>
                              {sub}
                            </Text>
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
  hintBox: {
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#1976d2',
  },
  hintText: {
    fontSize: 13,
    color: '#1565c0',
    lineHeight: 20,
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
    alignItems: 'flex-start',  // top 对齐, 允许左右高度不同
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
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  errorText: {
    color: '#ff3b30',
    fontSize: 12,
    marginTop: 4,
  },
  supplierIdBox: {
    backgroundColor: '#f5f5f5',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    borderStyle: 'dashed',
  },
  supplierIdText: {
    fontSize: 16,
    color: '#1976d2',
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  supplierIdPlaceholder: {
    color: '#999',
    fontWeight: '400',
    fontStyle: 'italic',
    fontFamily: Platform.OS === 'ios' ? undefined : 'sans-serif',
  },
  // 添加图片方框 (朋友圈风格: 浅灰底 + 灰色加号)
  imageUploadBox: {
    height: 80,  // 比编号输入框稍高 (和 AdminEditScreen 保持一致)
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
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
  positionItemCurrentLabel: {
    fontSize: 8,
    color: '#ff9800',
    marginTop: 1,
  },
  // 类目选择弹窗样式
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

export default NewDeviceScreen;
