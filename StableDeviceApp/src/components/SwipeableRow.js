/**
 * SwipeableRow - 微信风格左滑显示器件名+操作按钮
 *
 * 效果:
 * ┌────────────┬──────┬──────┐
 * │ 器件名称xxx│ 删除 │ 编辑 │   ← 左滑后从右侧露出
 * └────────────┴──────┴──────┘
 *      60%        20%   20%
 *
 * 实现要点:
 * - 用 position: 'absolute' + 固定 width (不用 flex)
 *   原因: Swipeable 用 native driver 跑 transform 动画, JS 端 flex 重新计算
 *   不及时, 会在按钮之间出现"白色空白"
 * - 用 onLayout 拿 row 实际宽度, 实时计算各区块 width
 *
 * 基于 react-native-gesture-handler/Swipeable
 */
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

const NAME_RATIO = 0.6;
const BTN_RATIO = 0.2;

const SwipeableRow = ({ children, deviceName, onEdit, onDelete }) => {
  const swipeableRef = useRef(null);
  const [rowWidth, setRowWidth] = useState(0);

  const handleEdit = () => {
    swipeableRef.current?.close();
    if (onEdit) onEdit();
  };

  const handleDelete = () => {
    swipeableRef.current?.close();
    if (onDelete) onDelete();
  };

  const nameWidth = rowWidth * NAME_RATIO;
  const btnWidth = rowWidth * BTN_RATIO;

  // 用 absolute + 固定 width (避免 flex + native animation 引起的空白问题)
  const renderRightActions = () => (
    <View style={styles.actionsContainer}>
      {/* 器件名标签 - 左 60% */}
      <View
        style={[
          styles.nameBox,
          { width: nameWidth, left: 0 },
        ]}
        pointerEvents="none"
      >
        <Text style={styles.nameText} numberOfLines={1}>
          {deviceName || '未命名器件'}
        </Text>
      </View>

      {/* 删除按钮 - 中 20% */}
      <TouchableOpacity
        style={[
          styles.actionButton,
          styles.deleteButton,
          { width: btnWidth, right: btnWidth },
        ]}
        onPress={handleDelete}
        activeOpacity={0.7}
      >
        <Text style={styles.actionText}>删除</Text>
      </TouchableOpacity>

      {/* 编辑按钮 - 右 20% */}
      <TouchableOpacity
        style={[
          styles.actionButton,
          styles.editButton,
          { width: btnWidth, right: 0 },
        ]}
        onPress={handleEdit}
        activeOpacity={0.7}
      >
        <Text style={styles.actionText}>编辑</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View
      onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
    >
      <Swipeable
        ref={swipeableRef}
        renderRightActions={renderRightActions}
        friction={1}              // 不减速, 拖多少走多少
        rightThreshold={20}       // 滑过 20px 就判定为打开
        overshootRight={false}    // 不允许过冲
      >
        {children}
      </Swipeable>
    </View>
  );
};

const styles = StyleSheet.create({
  actionsContainer: {
    flex: 1,
  },
  // 器件名标签 - 60% 宽, absolute 定位
  nameBox: {
    position: 'absolute',
    top: 0,
    bottom: 0,
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
  // 操作按钮 - 20% 宽, absolute 定位
  actionButton: {
    position: 'absolute',
    top: 0,
    bottom: 0,
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
