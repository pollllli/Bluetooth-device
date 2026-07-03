/**
 * 库存（器件架）管理页面
 *
 * 功能:
 * - 列出所有库存, 显示每个库存的器件数
 * - 添加新库存
 * - 重命名库存
 * - 删除库存 (二次确认, 默认连带删除该库存下所有器件)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  FlatList,
  Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ShelfService, { getShelves, getShelfDeviceCount } from '../services/ShelfService';
import { logError } from '../utils/ErrorHandler';

const ShelfManagerScreen = () => {
  const [shelves, setShelves] = useState([]);
  const [currentShelfId, setCurrentShelfIdState] = useState(null);
  const [deviceCounts, setDeviceCounts] = useState({}); // id -> count
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newShelfName, setNewShelfName] = useState('');
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameText, setRenameText] = useState('');

  const reload = useCallback(async () => {
    try {
      const list = await getShelves();
      setShelves(list);
      const currentId = await ShelfService.getCurrentShelfId();
      setCurrentShelfIdState(currentId);
      // 统计每个库存的器件数
      const counts = {};
      for (const s of list) {
        counts[s.id] = await getShelfDeviceCount(s.id);
      }
      setDeviceCounts(counts);
    } catch (err) {
      logError('加载库存列表失败', err, 'ShelfManagerScreen.reload');
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * 添加库存
   */
  const handleAdd = async () => {
    const name = newShelfName.trim();
    if (!name) {
      Alert.alert('提示', '请输入库存名称');
      return;
    }
    try {
      await ShelfService.addShelf(name);
      setShowAddModal(false);
      setNewShelfName('');
      await reload();
    } catch (err) {
      Alert.alert('添加失败', err.message);
    }
  };

  /**
   * 重命名库存
   */
  const handleRename = async () => {
    const name = renameText.trim();
    if (!name) {
      Alert.alert('提示', '请输入库存名称');
      return;
    }
    try {
      await ShelfService.renameShelf(renameTarget.id, name);
      setShowRenameModal(false);
      setRenameTarget(null);
      setRenameText('');
      await reload();
    } catch (err) {
      Alert.alert('重命名失败', err.message);
    }
  };

  /**
   * 删除库存: 二次确认
   */
  const handleDelete = (shelf) => {
    const count = deviceCounts[shelf.id] || 0;
    Alert.alert(
      '确认删除',
      `确定要删除库存 "${shelf.name}" 吗？\n\n该库存下的 ${count} 个器件也将被一并删除，且不可恢复。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              await ShelfService.deleteShelf(shelf.id);
              await reload();
            } catch (err) {
              Alert.alert('删除失败', err.message);
            }
          },
        },
      ]
    );
  };

  const openRename = (shelf) => {
    setRenameTarget(shelf);
    setRenameText(shelf.name);
    setShowRenameModal(true);
  };

  const renderItem = ({ item }) => {
    const isCurrent = item.id === currentShelfId;
    const count = deviceCounts[item.id] || 0;
    const hasBluetooth = !!(item.bluetoothMac && String(item.bluetoothMac).trim());
    return (
      <View style={[styles.item, isCurrent && styles.itemCurrent]}>
        <View style={styles.itemLeft}>
          {/* 当前库存: 蓝色边框 + 浅蓝背景 + 蓝色名字 已经够醒目, 不再单独画"当前"胶囊,
              避免长库存名被压换行 / 占用操作按钮空间 */}
          <Text style={[styles.itemName, isCurrent && styles.itemNameCurrent]}>
            {item.name}
          </Text>
          <View style={styles.itemMetaRow}>
            <Text style={styles.itemMeta}>器件数: {count}</Text>
            <View style={[
              styles.bluetoothBadge,
              hasBluetooth ? styles.bluetoothBadgeBound : styles.bluetoothBadgeUnbound,
            ]}>
              <Feather
                name={hasBluetooth ? 'bluetooth' : 'bluetooth-off'}
                size={12}
                color={hasBluetooth ? '#1976d2' : '#999'}
              />
              <Text style={[
                styles.bluetoothBadgeText,
                hasBluetooth ? styles.bluetoothBadgeTextBound : styles.bluetoothBadgeTextUnbound,
              ]}>
                {hasBluetooth ? `已绑定: ${item.bluetoothName || item.bluetoothMac}` : '未绑定蓝牙'}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.itemActions}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => openRename(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="edit-2" size={18} color="#999" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => handleDelete(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="trash-2" size={18} color="#999" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerHint}>
        <Text style={styles.headerHintText}>
          在此处可以新建、重命名、删除库存器件架。
        </Text>
      </View>

      <FlatList
        data={shelves}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>暂无库存，点击下方按钮添加</Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.addButton}
        onPress={() => {
          setNewShelfName('');
          setShowAddModal(true);
        }}
      >
        <Text style={styles.addButtonText}>+ 添加库存</Text>
      </TouchableOpacity>

      {/* 添加库存弹窗 */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>添加新库存</Text>
            <TextInput
              style={styles.modalInput}
              value={newShelfName}
              onChangeText={setNewShelfName}
              placeholder="请输入库存名称"
              maxLength={20}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setShowAddModal(false)}
              >
                <Text style={styles.modalBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm]}
                onPress={handleAdd}
              >
                <Text style={[styles.modalBtnText, styles.modalBtnTextConfirm]}>确定</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 重命名弹窗 */}
      <Modal
        visible={showRenameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRenameModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>重命名库存</Text>
            <TextInput
              style={styles.modalInput}
              value={renameText}
              onChangeText={setRenameText}
              placeholder="请输入新名称"
              maxLength={20}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setShowRenameModal(false)}
              >
                <Text style={styles.modalBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm]}
                onPress={handleRename}
              >
                <Text style={[styles.modalBtnText, styles.modalBtnTextConfirm]}>确定</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  headerHint: {
    backgroundColor: '#e3f2fd',
    padding: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#1976d2',
  },
  headerHintText: {
    fontSize: 12,
    color: '#1976d2',
    lineHeight: 18,
  },
  list: {
    padding: 12,
  },
  item: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  itemCurrent: {
    borderColor: '#1976d2',
    backgroundColor: '#e3f2fd',
  },
  itemLeft: {
    flex: 1,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  itemNameCurrent: {
    color: '#1976d2',
  },
  itemMeta: {
    fontSize: 12,
    color: '#999',
    marginRight: 8,
  },
  itemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    flexWrap: 'wrap',
  },
  bluetoothBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  bluetoothBadgeBound: {
    backgroundColor: '#e3f2fd',
    borderColor: '#90caf9',
  },
  bluetoothBadgeUnbound: {
    backgroundColor: '#f5f5f5',
    borderColor: '#ddd',
  },
  bluetoothBadgeText: {
    fontSize: 11,
    marginLeft: 3,
  },
  bluetoothBadgeTextBound: {
    color: '#1976d2',
  },
  bluetoothBadgeTextUnbound: {
    color: '#999',
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // 极简灰色图标按钮 (与分类管理界面一致: 无背景, 仅 Feather edit-2 / trash-2)
  iconButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginLeft: 6,
    minWidth: 32,
    alignItems: 'center',
  },
  addButton: {
    backgroundColor: '#1976d2',
    margin: 16,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  empty: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#999',
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 20,
    width: '100%',
    maxWidth: 360,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 10,
    fontSize: 14,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  modalBtnCancel: {
    backgroundColor: '#e0e0e0',
  },
  modalBtnConfirm: {
    backgroundColor: '#1976d2',
  },
  modalBtnText: {
    color: '#333',
    fontSize: 14,
  },
  modalBtnTextConfirm: {
    color: '#fff',
  },
});

export default ShelfManagerScreen;
