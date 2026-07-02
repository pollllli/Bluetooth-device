import React, { useRef, useState, useCallback } from 'react';
import { View, Text, Animated, TouchableOpacity, StyleSheet } from 'react-native';
import { PanGestureHandler, State } from 'react-native-gesture-handler';

/**
 * SwipeableRow - 左滑操作行
 *
 * 状态模型 (单值, 简化版):
 *   translateX.value = 当前视觉位置 (Animated.Value, 既是手势输出也是 spring 输出)
 *   lastOffsetRef.current = 上次静止位置 (仅在 spring 完成时被赋值)
 *
 * 手势中:  onGestureEvent 把 (tx + lastOffset) 钳到 [-160, 0] 直接 setValue
 * 手势 END: animateTo 用 spring 推动 translateX 到 target, 完成时 lastOffset = target
 * 新手势 BEGAN: stopAnimation 的 callback 把当前 value 写回 lastOffset
 *             (关键! 防止 spring 被新手势打断时 lastOffset 是 stale 的, 导致视觉跳变)
 *
 * 配套: 上层 FlatList 必须用 react-native-gesture-handler 的 FlatList
 * (否则 Android native scroll view 会吞掉所有触摸, PanGestureHandler 收不到 pan).
 */

const ACTION_BUTTON_WIDTH = 80;
const ACTIONS_TOTAL_WIDTH = ACTION_BUTTON_WIDTH * 2;
const SWIPE_THRESHOLD = ACTIONS_TOTAL_WIDTH / 2;
const VELOCITY_THRESHOLD = 800;

const SwipeableRow = ({ children, onEdit, onDelete }) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const lastOffsetRef = useRef(0);
  const [isOpen, setIsOpen] = useState(false);

  // 手势进行中: JS 回调里计算钳制后的视觉位置, 再 setValue
  // (不能用 Animated.event + useNativeDriver, 因为没法钳制; spring 阶段仍然 useNativeDriver)
  const onGestureEvent = useCallback(
    (event) => {
      const tx = event.nativeEvent.translationX;
      const effective = tx + lastOffsetRef.current;
      // 钳制: 视觉位置 ∈ [-ACTIONS_TOTAL_WIDTH, 0]
      const clamped = Math.min(0, Math.max(-ACTIONS_TOTAL_WIDTH, effective));
      translateX.setValue(clamped);
    },
    [translateX]
  );

  const animateTo = useCallback(
    (targetOffset, velocity = 0) => {
      const clampedTarget = Math.min(0, Math.max(-ACTIONS_TOTAL_WIDTH, targetOffset));
      const isOpening = clampedTarget === -ACTIONS_TOTAL_WIDTH;

      Animated.spring(translateX, {
        toValue: clampedTarget,
        useNativeDriver: true,
        velocity,
        bounciness: 0,                 // 临界阻尼, 不允许过冲
        speed: isOpening ? 14 : 9,     // 打开快 (飞过去), 关闭慢 (能看清收回)
      }).start(({ finished }) => {
        // 只有正常完成才更新 lastOffset. 被中断 (finished=false) 时不去碰它,
        // 因为 BEGAN 里的 stopAnimation callback 会负责同步.
        if (finished) {
          lastOffsetRef.current = clampedTarget;
        }
      });
    },
    [translateX]
  );

  const onHandlerStateChange = useCallback(
    (event) => {
      const { state, translationX: tx, velocityX } = event.nativeEvent;

      if (state === State.END) {
        const finalX = tx + lastOffsetRef.current;
        const shouldOpen =
          (finalX < -SWIPE_THRESHOLD && velocityX <= VELOCITY_THRESHOLD) ||
          velocityX < -VELOCITY_THRESHOLD;
        const target = shouldOpen ? -ACTIONS_TOTAL_WIDTH : 0;
        setIsOpen(shouldOpen);
        // 关闭时 velocity 强制 0 (正速度会让弹簧继续向右推造成过冲)
        // 打开时保留 velocityX (快速左滑有"飞过去"的惯性)
        const animVelocity = shouldOpen ? velocityX : 0;
        animateTo(target, animVelocity);
      } else if (state === State.CANCELLED || state === State.FAILED) {
        animateTo(lastOffsetRef.current, 0);
      } else if (state === State.BEGAN) {
        // 关键修复:
        //   上一手势的 spring 可能还在跑 (例如用户没等动画结束就再次触屏).
        //   如果不把当前 value 写回 lastOffsetRef, 后续 onGestureEvent 算 effective
        //   时用的是 stale 的 lastOffset, 视觉位置会瞬间跳到错误值.
        //
        //   单一值模型下, translateX.value 就是当前视觉位置, 直接存就行.
        //   - 如果 spring 在跑: callback 拿到的是被打断时的 value
        //   - 如果 spring 没跑: callback 拿到的是当前静态 value (写回不改变语义)
        translateX.stopAnimation((value) => {
          lastOffsetRef.current = value;
        });
      }
    },
    [animateTo, translateX]
  );

  const close = useCallback(() => {
    setIsOpen(false);
    animateTo(0, 0);
  }, [animateTo]);

  const handleEdit = useCallback(() => {
    close();
    if (onEdit) onEdit();
  }, [close, onEdit]);

  const handleDelete = useCallback(() => {
    close();
    if (onDelete) onDelete();
  }, [close, onDelete]);

  return (
    <View style={styles.container}>
      <View
        style={styles.actionsContainer}
        pointerEvents={isOpen ? 'auto' : 'box-none'}
      >
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

      <PanGestureHandler
        onGestureEvent={onGestureEvent}
        onHandlerStateChange={onHandlerStateChange}
        activeOffsetX={[-10, 10]}
      >
        <Animated.View
          style={[styles.row, { transform: [{ translateX }] }]}
        >
          {children}
        </Animated.View>
      </PanGestureHandler>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  },
  actionsContainer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  actionButton: {
    width: ACTION_BUTTON_WIDTH,
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
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  row: {
    backgroundColor: '#ffffff',
  },
});

export default SwipeableRow;
