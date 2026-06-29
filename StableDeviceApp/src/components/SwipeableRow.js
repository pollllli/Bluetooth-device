/**
 * SwipeableRow - 微信风格左滑显示器件名+操作按钮
 *
 * 效果(图2):
 * ┌────────────┬──────┬──────┐
 * │ 器件名称xxx│ 删除 │ 编辑 │   ← 左滑后从右侧露出
 * └────────────┴──────┴──────┘
 *      60%        20%   20%
 *
 * - 左滑 20px 就判定为打开(轻滑即触发)
 * - 三个区块整体渐进式展开(Swipeable 内置 spring 动画)
 * - 右滑 20px 就判定为关闭, 回到原始器件信息标签
 *
 * 基于 react-native-gesture-handler/Swipeable
 */
import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

const SwipeableRow = ({ children, deviceName, onEdit, onDelete }) => {
  const swipeableRef = useRef(null);

  const handleEdit = () => {
    swipeableRef.current?.close();
    if (onEdit) onEdit();
  };

  const handleDelete = () => {
    swipeableRef.current?.close();
    if (onDelete) onDelete();
  };

  // 渲染右侧 actions - 微信风格: 器件名标签 + 删除 + 编辑
  // flex 比例 3:1:1 = 60% : 20% : 20% (图2)
  const renderRightActions = () => (
    <View style={styles.actionsContainer}>
      {/* 器件名标签 - flex: 3 (60%) */}
      <View style={styles.nameBox}>
        <Text style={styles.nameText} numberOfLines={1}>
          {deviceName || '未命名器件'}
        </Text>
      </View>

      {/* 删除按钮 - flex: 1 (20%) */}
      <TouchableOpacity
        style={[styles.actionButton, styles.deleteButton]}
        onPress={handleDelete}
        activeOpacity={0.7}
      >
        <Text style={styles.actionText}>删除</Text>
      </TouchableOpacity>

      {/* 编辑按钮 - flex: 1 (20%) */}
      <TouchableOpacity
        style={[styles.actionButton, styles.editButton]}
        onPress={handleEdit}
        activeOpacity={0.7}
      >
        <Text style={styles.actionText}>编辑</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      friction={1}              // 不减速, 拖多少走多少
      rightThreshold={20}       // 滑过 20px 就判定为打开
      overshootRight={false}    // 不允许过冲
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
  // 器件名标签 - 60% 宽
  nameBox: {
    flex: 3,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  nameText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1976d2',
  },
  // 操作按钮 - 20% 宽
  actionButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: {
    backgroundColor: '#ff3b30',
  },
  editButton: {
    backgroundColor: '#1976d2',
  },
  actionText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default SwipeableRow;
