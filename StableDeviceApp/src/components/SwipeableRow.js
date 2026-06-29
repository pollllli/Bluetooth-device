/**
 * SwipeableRow - 微信风格左滑显示操作按钮
 *
 * 效果:
 * - 轻轻左滑就判定手势成功(rightThreshold 极小)
 * - 编辑按钮先从右侧出现(宽度 0->80 渐进)
 * - 删除按钮随后从编辑按钮左侧出现(宽度 0->80 渐进)
 * - 右滑时,删除按钮先消失(宽度 80->0),编辑按钮后消失
 *
 * 基于 react-native-gesture-handler/Swipeable
 */
import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

const ACTION_WIDTH = 80;     // 每个按钮宽度
const RIGHT_WIDTH = ACTION_WIDTH * 2;  // 总共露出宽度 160

const SwipeableRow = ({ children, onEdit, onDelete }) => {
  const swipeableRef = useRef(null);

  const handleEdit = () => {
    swipeableRef.current?.close();
    if (onEdit) onEdit();
  };

  const handleDelete = () => {
    swipeableRef.current?.close();
    if (onDelete) onDelete();
  };

  // 渲染右侧 actions - 微信风格渐进式展开
  // dragX 范围: 0 (关闭) 到 -RIGHT_WIDTH (完全打开)
  const renderRightActions = (progress, dragX) => {
    // 编辑按钮: 永远在右侧 (right: 0)
    //   - 用户左滑 0-160px 时, 宽度 0 -> 80 渐进
    const editWidth = dragX.interpolate({
      inputRange: [-RIGHT_WIDTH, 0],
      outputRange: [ACTION_WIDTH, 0],
      extrapolate: 'clamp',
    });

    // 删除按钮: 永远在编辑按钮左边 (right: ACTION_WIDTH = 80)
    //   - 用户左滑 0-80px 时: 删除按钮宽度保持 0
    //   - 用户左滑 80-160px 时: 删除按钮宽度 0 -> 80
    const deleteWidth = dragX.interpolate({
      inputRange: [-RIGHT_WIDTH, -ACTION_WIDTH, 0],
      outputRange: [ACTION_WIDTH, ACTION_WIDTH, 0],
      extrapolate: 'clamp',
    });

    return (
      <View style={styles.actionsContainer}>
        {/* 删除按钮 - 在编辑按钮左边 */}
        <Animated.View
          style={[
            styles.actionContainer,
            { width: deleteWidth, right: ACTION_WIDTH },
          ]}
        >
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={handleDelete}
            activeOpacity={0.7}
          >
            <Text style={styles.actionText}>删除</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* 编辑按钮 - 在最右侧 */}
        <Animated.View
          style={[
            styles.actionContainer,
            { width: editWidth, right: 0 },
          ]}
        >
          <TouchableOpacity
            style={[styles.actionButton, styles.editButton]}
            onPress={handleEdit}
            activeOpacity={0.7}
          >
            <Text style={styles.actionText}>编辑</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      friction={1}              // 不减速, 拖多少走多少, 轻滑也能触发
      rightThreshold={20}       // 滑过 20px 就判定为打开(微信风格)
      overshootRight={false}    // 不允许过冲, 避免视觉跳变
      useNativeAnimations       // 用原生线程动画(更流畅)
    >
      {children}
    </Swipeable>
  );
};

const styles = StyleSheet.create({
  actionsContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  actionContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  actionButton: {
    flex: 1,
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
});

export default SwipeableRow;
