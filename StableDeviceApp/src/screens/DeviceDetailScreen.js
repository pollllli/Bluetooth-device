import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import StorageService from '../services/StorageService';
import colors from '../theme/colors';

const DeviceDetailScreen = ({ navigation, route }) => {
  const { device, isAdmin } = route.params || { device: {}, isAdmin: false };
  const [isSending, setIsSending] = useState(false);
  const [hardwarePosition, setHardwarePosition] = useState(1);

  const getHardwarePosition = useMemo(async () => {
    try {
      // 优先使用设备的location字段，如果没有则使用数组索引
      if (device.location != null && device.location !== '') {
        const parsedLocation = parseInt(device.location, 10);
        if (!isNaN(parsedLocation)) {
          setHardwarePosition(parsedLocation);
          return parsedLocation;
        }
      }
      // 如果location无效或不存在，则使用数组索引
      const devices = await StorageService.getDevices();
      const index = devices.findIndex((d) => d.id === device.id);
      const position = index >= 0 ? index + 1 : 1;
      setHardwarePosition(position);
      return position;
    } catch (error) {
      console.error('获取硬件位置失败:', error);
      return 1;
    }
  }, [device.id, device.location]);

  const handleSendCommand = async () => {
    if (!global.deviceConnection) {
      Alert.alert('提示', '请先在连接页面连接蓝牙设备');
      return;
    }

    setIsSending(true);
    try {
      const { handler } = global.deviceConnection;
      const position = await getHardwarePosition;

      const response = await handler.sendCommand({
        type: 'lightOn',
        lightId: position,
      });

      if (response.success) {
        // no popup
      } else {
        Alert.alert('错误', `亮灯失败: ${response.message}`);
      }
    } catch (error) {
      console.error('发送指令失败:', error);
      Alert.alert('错误', `发送指令失败: ${error.message || '未知错误'}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleTakeOutDevice = async () => {
    if (!global.deviceConnection) {
      Alert.alert('提示', '请先在连接页面连接蓝牙设备');
      return;
    }

    setIsSending(true);
    try {
      const { handler } = global.deviceConnection;
      const position = await getHardwarePosition;

      const response = await handler.sendCommand({
        type: 'lightOff',
        lightId: position,
      });

      if (response.success) {
        // no popup
      } else {
        Alert.alert('错误', `取出失败: ${response.message}`);
      }
    } catch (error) {
      console.error('发送指令失败:', error);
      Alert.alert('错误', '发送指令失败，请检查设备连接');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.deviceCard}>
        <View style={styles.deviceIdContainer}>
          <Text style={styles.deviceId}>
            编号: {device.supplierId || device.id}
          </Text>
        </View>
        <Text style={styles.deviceName}>{device.name}</Text>

        {/* 基本信息 */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>基本信息</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>编号</Text>
            <Text style={styles.infoValue}>{device.supplierId || device.id || '-'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>名称</Text>
            <Text style={styles.infoValue}>{device.name || '-'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>类目</Text>
            <Text style={styles.infoValue}>{device.category || '-'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>封装</Text>
            <Text style={styles.infoValue}>{device.package || '-'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>品牌</Text>
            <Text style={styles.infoValue}>{device.brand || '-'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>数量</Text>
            <Text style={styles.infoValue}>{device.quantity || 1}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>位置</Text>
            <Text style={styles.infoValue}>{device.location != null && device.location !== '' ? device.location : '-'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>备注</Text>
            <Text style={styles.infoValue}>{device.notes || '-'}</Text>
          </View>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.sendButton, isSending && styles.sendButtonDisabled]}
            onPress={handleSendCommand}
            disabled={isSending}
          >
            <Text style={styles.sendButtonText}>
              {isSending ? '发送中...' : '请求此器件'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.takeOutButton,
              isSending && styles.sendButtonDisabled,
            ]}
            onPress={handleTakeOutDevice}
            disabled={isSending}
          >
            <Text style={styles.takeOutButtonText}>
              {isSending ? '发送中...' : '取出器件'}
            </Text>
          </TouchableOpacity>
        </View>

        {isAdmin && (
          <TouchableOpacity
            style={styles.editButton}
            onPress={() =>
              navigation.navigate('AdminEdit', {
                device: device,
                isNew: false,
                onSave: () => {
                  navigation.goBack();
                },
              })
            }
          >
            <Text style={styles.editButtonText}>编辑器件</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 16,
  },
  deviceCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 8,
    padding: 24,
    shadowColor: colors.shadow,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  deviceIdContainer: {
    backgroundColor: colors.accent,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 20,
  },
  deviceId: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  deviceName: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 16,
  },
  deviceFunction: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 24,
  },
  sectionContainer: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
    width: 60,
  },
  infoValue: {
    fontSize: 16,
    color: colors.textPrimary,
    flex: 1,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sendButton: {
    backgroundColor: colors.success,
    padding: 16,
    borderRadius: 28,
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
    shadowColor: colors.shadow,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  takeOutButton: {
    backgroundColor: colors.danger,
    padding: 16,
    borderRadius: 28,
    alignItems: 'center',
    flex: 1,
    marginLeft: 10,
    shadowColor: colors.shadow,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  sendButtonDisabled: {
    backgroundColor: colors.textMuted,
  },
  sendButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  takeOutButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  editButton: {
    backgroundColor: colors.accent,
    padding: 16,
    borderRadius: 28,
    alignItems: 'center',
    shadowColor: colors.shadow,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  editButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default DeviceDetailScreen;
