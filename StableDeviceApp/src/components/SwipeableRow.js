/**
 * SwipeableRow - 微信风格左滑显示器件名+操作按钮
 *
 * 效果(图2):
 * ╭────────────┬──────┬─────╮
 * │ 器件名称xxx│ 删除 │ 编辑 │   ← 左滑后从右侧露出
 * ╰────────────┴──────┴─────╯
 *      60%        20%   20%
 *
 * 圆角策略:
 * - 左半边 (nameBox) 用 borderTopLeftRadius + borderBottomLeftRadius
 * - 右半边 (editButton) 用 borderTopRightRadius + borderBottomRightRadius
 * - 中间 (deleteButton) 不需要圆角
 * - 圆角值透传自 tagStyle.borderRadius (与原始 deviceTag 保持一致)
 *   这样左滑/右滑过程中不会从圆角突变为方角
 *
 * 实现要点:
 * - position: absolute + 固定 width (不用 flex)
 * - 用 onLayout 拿 row 实际宽度, 实时计算各区块 width
 *
 * 基于 react-native-gesture-handler/Swipeable
 */
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

const NAME_RATIO = 0.6;
const BTN_RATIO = 0.2;
const DEFAULT_BORDER_RADIUS = 12;

const SwipeableRow = ({ children, deviceName, tagStyle, onEdit, onDelete }) => {
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
  // 透传 deviceTag 的圆角值, 保证左滑/右滑过程中圆角一致
  const borderRadius = tagStyle?.borderRadius ?? DEFAULT_BORDER_RADIUS;

  // 用 absolute + 固定 width (避免 flex + native animation 引起的空白问题)
  const renderRightActions = () => (
    <View style={styles.actionsContainer}>
      {/* 器件名标签 - 左 60%, 仅左半边圆角 */}
      <View
        style={[
          styles.nameBox,
          {
            width: nameWidth,
            left: 0,
            borderTopLeftRadius: borderRadius,
            borderBottomLeftRadius: borderRadius,
          },
        ]}
        pointerEvents="none"
      >
        <Text style={styles.nameText} numberOfLines={1}>
          {deviceName || '未命名器件'}
        </Text>
      </View>

      {/* 删除按钮 - 中 20%, 不用圆角 (中间) */}
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

      {/* 编辑按钮 - 右 20%, 仅右半边圆角 */}
      <TouchableOpacity
        style={[
          styles.actionButton,
          styles.editButton,
          {
            width: btnWidth,
            right: 0,
            borderTopRightRadius: borderRadius,
            borderBottomRightRadius: borderRadius,
          },
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
  // 器件名标签 - absolute 定位, 仅左半边圆角
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
  // 操作按钮 - absolute 定位
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
