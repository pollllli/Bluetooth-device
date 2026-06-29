/**
 * SwipeableRow - QQ 风格左滑显示操作按钮
 *
 * 用法:
 *   <SwipeableRow onEdit={...} onDelete={...}>
 *     <TouchableOpacity>...</TouchableOpacity>
 *   </SwipeableRow>
 *
 * - 向左滑动显示右侧的"编辑"/"删除"按钮(QQ 风格)
 * - 点击按钮触发 onEdit / onDelete 回调
 * - 再次左滑超过阈值再次展开,右滑/轻滑关闭
 * - 子组件(TouchableOpacity)的 onPress 不受影响(短按时不触发 PanResponder)
 */
import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Animated,
  PanResponder,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';

const ACTION_WIDTH = 80;
const SWIPE_THRESHOLD = 50; // 滑过此距离算展开

const SwipeableRow = ({ children, onEdit, onDelete }) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpenRef = useRef(false);
  const [, forceUpdate] = useState(0);

  const animateTo = (toValue) => {
    Animated.spring(translateX, {
      toValue,
      useNativeDriver: true,
      bounciness: 0,
      speed: 14,
    }).start();
  };

  const open = () => {
    isOpenRef.current = true;
    animateTo(-2 * ACTION_WIDTH);
    forceUpdate((n) => n + 1);
  };

  const close = () => {
    isOpenRef.current = false;
    animateTo(0);
    forceUpdate((n) => n + 1);
  };

  const panResponder = useRef(
    PanResponder.create({
      // 仅在水平滑动超过 5px 时拦截(避免误触)
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 5 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => {
        // 停止当前动画,避免跳变
        translateX.stopAnimation();
      },
      onPanResponderMove: (_, g) => {
        const baseOffset = isOpenRef.current ? -2 * ACTION_WIDTH : 0;
        const newOffset = baseOffset + g.dx;
        // 限制范围:[-2*ACTION_WIDTH, ACTION_WIDTH],允许稍微越过关闭点
        if (newOffset <= ACTION_WIDTH && newOffset >= -3 * ACTION_WIDTH) {
          translateX.setValue(newOffset);
        }
      },
      onPanResponderRelease: (_, g) => {
        const finalOffset = (isOpenRef.current ? -2 * ACTION_WIDTH : 0) + g.dx;
        // 已经展开:右滑超阈值则关闭
        // 关闭:左滑超阈值则展开
        if (isOpenRef.current) {
          if (finalOffset > -2 * ACTION_WIDTH + SWIPE_THRESHOLD) {
            close();
          } else {
            open();
          }
        } else {
          if (finalOffset < -SWIPE_THRESHOLD) {
            open();
          } else {
            close();
          }
        }
      },
      onPanResponderTerminate: () => {
        // 手势被中断(例如 ScrollView 抢走),回弹到原状态
        isOpenRef.current ? open() : close();
      },
    })
  ).current;

  const handleEdit = () => {
    close();
    if (onEdit) onEdit();
  };

  const handleDelete = () => {
    close();
    if (onDelete) onDelete();
  };

  return (
    <View style={styles.container}>
      {/* 右侧操作按钮(背景层) */}
      <View style={styles.actions} pointerEvents="box-none">
        <TouchableOpacity
          style={[styles.actionButton, styles.editButton]}
          onPress={handleEdit}
          activeOpacity={0.7}
        >
          <Text style={styles.actionText}>编辑</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.deleteButton]}
          onPress={handleDelete}
          activeOpacity={0.7}
        >
          <Text style={styles.actionText}>删除</Text>
        </TouchableOpacity>
      </View>

      {/* 前景内容(可滑动) */}
      <Animated.View
        style={[styles.foreground, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
  },
  actions: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  actionButton: {
    width: ACTION_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editButton: {
    backgroundColor: '#1976d2',
  },
  deleteButton: {
    backgroundColor: '#ff3b30',
  },
  actionText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  foreground: {
    backgroundColor: 'transparent',
  },
});

export default SwipeableRow;
