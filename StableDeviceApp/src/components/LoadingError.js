// 加载和错误提示组件
// 用于显示加载状态和错误信息，可在多个屏幕中重用

import React from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';

/**
 * 加载状态组件
 * @param {Object} props - 组件属性
 * @param {string} props.message - 加载消息
 * @param {boolean} props.fullScreen - 是否全屏显示
 */
export const Loading = ({ message = '加载中...', fullScreen = false }) => {
  return (
    <View style={[styles.container, fullScreen && styles.fullScreen]}>
      <ActivityIndicator size="large" color="#1976d2" />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
};

/**
 * 错误提示组件
 * @param {Object} props - 组件属性
 * @param {string} props.message - 错误消息
 * @param {Function} props.onRetry - 重试回调函数
 * @param {boolean} props.fullScreen - 是否全屏显示
 */
export const ErrorMessage = ({
  message = '发生错误',
  onRetry,
  fullScreen = false,
}) => {
  return (
    <View style={[styles.container, fullScreen && styles.fullScreen]}>
      <Text style={styles.errorIcon}>❌</Text>
      <Text style={styles.errorMessage}>{message}</Text>
      {onRetry && (
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <Text style={styles.retryButtonText}>重试</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

/**
 * 空状态组件
 * @param {Object} props - 组件属性
 * @param {string} props.message - 空状态消息
 * @param {string} props.icon - 空状态图标
 * @param {boolean} props.fullScreen - 是否全屏显示
 */
export const EmptyState = ({
  message = '暂无数据',
  icon = '📭',
  fullScreen = false,
}) => {
  return (
    <View style={[styles.container, fullScreen && styles.fullScreen]}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullScreen: {
    flex: 1,
  },
  message: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorMessage: {
    fontSize: 16,
    color: '#ff3b30',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#1976d2',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyMessage: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
});
