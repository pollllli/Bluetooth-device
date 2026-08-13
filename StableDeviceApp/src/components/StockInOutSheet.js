/**
 * 存取弹窗组件
 *
 * 功能: 点击器件标签后弹出, 直接调整目标库存数量
 * - 中间数字 = 目标库存数量, 初始 = 当前库存
 * - "+" 增加目标库存 (= 存入)
 * - "-" 减少目标库存 (= 取用)
 * - 手动输入目标数量, 自动计算存入/取出差值
 * - 当前库存旁显示箭头 → 新库存
 * - 下方小字提示"存入 X 件" / "取出 X 件"
 * - KeyboardAvoidingView 防止键盘遮挡弹窗
 *
 * Props:
 *   visible    {boolean}      是否显示
 *   device     {Object|null}  当前操作的器件
 *   onClose    {Function}     关闭回调
 *   onConfirm  {Function}     确认回调 (mode, delta) => mode: 'in'|'out', delta: number (正数)
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  Keyboard,
} from 'react-native';

const MAX_IN = 99999; // 存入上限

const StockInOutSheet = ({ visible, device, onClose, onConfirm }) => {
  const [targetQty, setTargetQty] = useState(0);
  const [targetText, setTargetText] = useState('0');
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // 键盘监听: Android 上 KeyboardAvoidingView 在 Modal 内不生效, 手动处理
  useEffect(() => {
    if (!visible) return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
      setKeyboardHeight(0);
    };
  }, [visible]);

  // 每次打开弹窗 / 切换器件时, 初始化为当前库存
  useEffect(() => {
    if (visible && device) {
      const cq = Number(device.quantity) || 0;
      setTargetQty(cq);
      setTargetText(String(cq));
    }
  }, [visible, device?.id]);

  const currentQty = device ? Number(device.quantity) || 0 : 0;
  const delta = targetQty - currentQty; // 正 = 存入, 负 = 取用
  const isStore = delta > 0;
  const isTake = delta < 0;
  const absDelta = Math.abs(delta);
  const noChange = delta === 0;

  // 边界
  const minQty = 0;
  const maxQty = MAX_IN;

  // "-" 按钮: 减少目标库存
  const handleMinus = useCallback(() => {
    setTargetQty((t) => {
      const next = Math.max(minQty, t - 1);
      setTargetText(String(next));
      return next;
    });
  }, []);

  // "+" 按钮: 增加目标库存
  const handlePlus = useCallback(() => {
    setTargetQty((t) => {
      const next = Math.min(maxQty, t + 1);
      setTargetText(String(next));
      return next;
    });
  }, []);

  // 手动输入目标数量
  const handleTextChange = useCallback((text) => {
    const filtered = text.replace(/[^0-9]/g, '');
    setTargetText(filtered);
    if (filtered !== '') {
      const n = parseInt(filtered, 10);
      if (!isNaN(n)) {
        setTargetQty(Math.min(n, maxQty));
      }
    }
  }, []);

  // 失焦时 clamp
  const handleTextBlur = useCallback(() => {
    const n = parseInt(targetText, 10);
    if (isNaN(n) || n < minQty) {
      setTargetQty(currentQty);
      setTargetText(String(currentQty));
    } else {
      const clamped = Math.max(minQty, Math.min(n, maxQty));
      setTargetQty(clamped);
      setTargetText(String(clamped));
    }
  }, [targetText, currentQty]);

  const handleConfirm = useCallback(() => {
    if (noChange) return;
    const mode = isStore ? 'in' : 'out';
    if (onConfirm) onConfirm(mode, absDelta);
  }, [noChange, isStore, absDelta, onConfirm]);

  if (!visible || !device) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { paddingBottom: keyboardHeight }]}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
          <View style={styles.sheet}>
            <View style={styles.handle} />

            {/* 头部: 器件名 + 位置/类目 */}
            <View style={styles.header}>
              <Text style={styles.name} numberOfLines={1}>
                {device.name || '未命名'}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {device.location != null && device.location !== ''
                  ? `位置 ${device.location}`
                  : '无位置'}
                {' · '}
                {device.category || '未分类'}
              </Text>
            </View>

            {/* 库存变化: 当前库存 → 新库存 */}
            <View style={styles.stockRow}>
              <View style={styles.stockBlock}>
                <Text style={styles.stockNum}>{currentQty}</Text>
                <Text style={styles.stockLabel}>当前库存</Text>
              </View>
              <Text style={styles.stockArrow}>→</Text>
              <View style={styles.stockBlock}>
                <Text
                  style={[
                    styles.stockNum,
                    isStore && styles.stockNumIn,
                    isTake && styles.stockNumOut,
                  ]}
                >
                  {targetQty}
                </Text>
                <Text style={styles.stockLabel}>新库存</Text>
              </View>
            </View>

            {/* 数量步进器 + 手动输入 */}
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[
                  styles.stepBtn,
                  isTake && styles.stepBtnActiveOut,
                  targetQty <= minQty && styles.stepBtnDisabled,
                ]}
                onPress={handleMinus}
                disabled={targetQty <= minQty}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.stepBtnText,
                    isTake && styles.stepBtnTextActiveOut,
                  ]}
                >
                  −
                </Text>
              </TouchableOpacity>

              <TextInput
                style={[
                  styles.qtyInput,
                  isStore && styles.qtyInputIn,
                  isTake && styles.qtyInputOut,
                ]}
                value={targetText}
                onChangeText={handleTextChange}
                onBlur={handleTextBlur}
                keyboardType="numeric"
                selectTextOnFocus
                maxLength={6}
              />

              <TouchableOpacity
                style={[
                  styles.stepBtn,
                  isStore && styles.stepBtnActiveIn,
                  targetQty >= maxQty && styles.stepBtnDisabled,
                ]}
                onPress={handlePlus}
                disabled={targetQty >= maxQty}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.stepBtnText,
                    isStore && styles.stepBtnTextActiveIn,
                  ]}
                >
                  +
                </Text>
              </TouchableOpacity>
            </View>

            {/* 操作提示: 存入/取出多少件 */}
            <View style={styles.hintRow}>
              {noChange ? (
                <Text style={styles.hintNeutral}>数量未变动</Text>
              ) : isStore ? (
                <Text style={styles.hintIn}>
                  存入 <Text style={styles.hintBold}>{absDelta}</Text> 件
                </Text>
              ) : (
                <Text style={styles.hintOut}>
                  取出 <Text style={styles.hintBold}>{absDelta}</Text> 件
                </Text>
              )}
            </View>

            {/* 操作按钮 */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={onClose}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  noChange
                    ? styles.confirmBtnDisabled
                    : isStore
                      ? styles.confirmBtnIn
                      : styles.confirmBtnOut,
                ]}
                onPress={handleConfirm}
                disabled={noChange}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmBtnText}>确认</Text>
              </TouchableOpacity>
            </View>
          </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 20,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#ddd',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
    alignItems: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  meta: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  // 库存变化显示
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 16,
  },
  stockBlock: {
    alignItems: 'center',
  },
  stockNum: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
  },
  stockNumIn: {
    color: '#1976d2',
  },
  stockNumOut: {
    color: '#4caf50',
  },
  stockArrow: {
    fontSize: 22,
    color: '#bbb',
    marginTop: -6,
  },
  stockLabel: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  // 步进器 + 手动输入
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#e4e6eb',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnActiveIn: {
    borderColor: '#1976d2',
    backgroundColor: 'rgba(25,118,210,0.08)',
  },
  stepBtnActiveOut: {
    borderColor: '#4caf50',
    backgroundColor: 'rgba(76,175,80,0.08)',
  },
  stepBtnDisabled: {
    opacity: 0.35,
  },
  stepBtnText: {
    fontSize: 24,
    fontWeight: '600',
    color: '#999',
  },
  stepBtnTextActiveIn: {
    color: '#1976d2',
  },
  stepBtnTextActiveOut: {
    color: '#4caf50',
  },
  qtyInput: {
    minWidth: 72,
    height: 44,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    borderBottomWidth: 2,
    borderBottomColor: '#e4e6eb',
    paddingHorizontal: 4,
    paddingVertical: 0,
  },
  qtyInputIn: {
    borderBottomColor: '#1976d2',
  },
  qtyInputOut: {
    borderBottomColor: '#4caf50',
  },
  // 操作提示
  hintRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  hintNeutral: {
    fontSize: 13,
    color: '#bbb',
  },
  hintIn: {
    fontSize: 13,
    color: '#1976d2',
  },
  hintOut: {
    fontSize: 13,
    color: '#4caf50',
  },
  hintBold: {
    fontWeight: '700',
  },
  // 操作按钮
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#f7f8fa',
    borderWidth: 1,
    borderColor: '#e4e6eb',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
  },
  confirmBtn: {
    flex: 1.4,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmBtnIn: {
    backgroundColor: '#1976d2',
  },
  confirmBtnOut: {
    backgroundColor: '#4caf50',
  },
  confirmBtnDisabled: {
    backgroundColor: '#ccc',
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});

export default StockInOutSheet;