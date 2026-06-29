/**
 * SwipeableRow - QQ 风格左滑显示操作按钮(基于 react-native-gesture-handler/Swipeable)
 *
 * 相比自己写 PanResponder 的优势:
 * - 使用原生手势处理(native thread),不会因 forceUpdate / useNativeDriver 引发崩溃
 * - 多 Swipeable 实例同时挂载也安全
 * - 自动处理 unmount 时的手势清理
 *
 * 用法:
 *   <SwipeableRow onEdit={...} onDelete={...}>
 *     <TouchableOpacity>...</TouchableOpacity>
 *   </SwipeableRow>
 *
 * - 向左滑动显示右侧的"编辑"/"删除"按钮
 * - 点击按钮触发 onEdit / onDelete 回调
 * - 触发后自动 close()
 */
import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

const ACTION_WIDTH = 80;

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

  // 右侧 actions - 向左滑时显示
  const renderRightActions = () => (
    <View style={styles.actions}>
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
  );

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
    >
      {children}
    </Swipeable>
  );
};

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    width: ACTION_WIDTH * 2,
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
});

export default SwipeableRow;
