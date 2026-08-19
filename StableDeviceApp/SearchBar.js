/**
 * NeuSearchBar - 新拟物(下沉式)搜索框 · Expo / React Native
 * 依赖: expo-linear-gradient, @expo/vector-icons (Expo 模板自带)
 *
 * 特性:
 *  - 内凹(inset)浮雕: 上/左暗渐变 + 下/右亮渐变, 肉眼下沉
 *  - 聚焦时绿色描边淡入 + 右侧滑出「取消」按钮
 *  - 有内容时显示一键清空(×)
 *  - returnKeyType="search", 回车触发 onSubmit
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import colors from './src/theme/colors';

const INSET_BG = '#E3E9ED';
const PLACEHOLDER = colors.textSecondary;   // 暖深灰蓝灰系 (与全站主题一致)
const TEXT = colors.textPrimary;            // 暖深灰 #37474F (与底部导航/标题文字同色)
const SUB = colors.textMuted;               // 浅灰

export default function NeuSearchBar({
  value,
  onChangeText,
  onSubmit,
  onCancel,
  placeholder = 'Search',
  radius = 16,
  height = 48,
  style,
}) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const focusAnim = useRef(new Animated.Value(0)).current; // 0 失焦 / 1 聚焦
  const cancelAnim = useRef(new Animated.Value(0)).current; // 取消按钮展开

  const showCancel = focused || (value && value.length > 0);

  useEffect(() => {
    Animated.timing(focusAnim, {
      toValue: focused ? 1 : 0,
      duration: 160,
      useNativeDriver: false,
    }).start();
  }, [focused, focusAnim]);

  useEffect(() => {
    Animated.timing(cancelAnim, {
      toValue: showCancel ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [showCancel, cancelAnim]);

  // 聚焦描边颜色: 透明 -> 主题绿
  const ringColor = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(47,218,162,0)', 'rgba(47,218,162,1)'],
  });

  const handleCancel = () => {
    onChangeText?.('');
    inputRef.current?.blur();
    onCancel?.();
  };

  return (
    <View style={[styles.wrap, style]}>
      {/* ===== 下沉容器 ===== */}
      <View style={[styles.inset, { borderRadius: radius, height }]}>
        {/* 四条内侧渐变: 上暗 / 下亮 / 左暗 / 右亮 */}
        <LinearGradient
          colors={['rgba(150,168,180,0.50)', 'rgba(150,168,180,0)']}
          style={[styles.insetH, { top: 0 }]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.9)']}
          style={[styles.insetH, { bottom: 0 }]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['rgba(150,168,180,0.35)', 'rgba(150,168,180,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.insetV, { left: 0 }]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.8)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.insetV, { right: 0 }]}
          pointerEvents="none"
        />

        {/* 聚焦描边(淡入) */}
        <Animated.View
          pointerEvents="none"
          style={[styles.focusRing, { borderRadius: radius, borderColor: ringColor }]}
        />

        {/* 内容行: 放大镜 + 输入框 + 清空按钮 */}
        <View style={styles.row}>
          <Ionicons name="search" size={18} color={PLACEHOLDER} style={{ marginLeft: 16 }} />
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={PLACEHOLDER}
            style={styles.input}
            returnKeyType="search"
            onSubmitEditing={onSubmit}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          {value?.length > 0 && (
            <TouchableOpacity
              onPress={() => onChangeText?.('')}
              hitSlop={8}
              style={styles.clearBtn}
            >
              <Ionicons name="close-circle" size={17} color={PLACEHOLDER} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ===== 取消按钮(聚焦时滑出) ===== */}
      <Animated.View
        style={{
          width: cancelAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 58] }),
          opacity: cancelAnim,
          overflow: 'hidden',
        }}
      >
        <TouchableOpacity onPress={handleCancel} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>取消</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center' },
  inset: {
    flex: 1,
    backgroundColor: INSET_BG,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  insetH: { position: 'absolute', left: 0, right: 0, height: 12 },
  insetV: { position: 'absolute', top: 0, bottom: 0, width: 10 },
  focusRing: { ...StyleSheet.absoluteFillObject, borderWidth: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
    color: TEXT,
    paddingVertical: 0,
  },
  clearBtn: { paddingHorizontal: 12 },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingLeft: 10 },
  cancelText: { fontSize: 15, color: SUB },
});
