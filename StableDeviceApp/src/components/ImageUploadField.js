/**
 * ImageUploadField - 公共器件图片上传组件
 *
 * 封装内容:
 * - expo-image-picker 调用 (相册选图 + 现场拍照)
 * - Android 13+ 权限请求 (READ_MEDIA_IMAGES / CAMERA)
 * - iOS 相册权限请求 (NSPhotoLibraryUsageDescription / NSCameraUsageDescription)
 * - 选中后预览: 已选图显示 Image, 点 × 删除回到 +
 * - 单击图片可全屏放大查看, 再次点击/返回键关闭
 *
 * 关键设计:
 * - allowsEditing = false: vivo/华为/小米等厂商的"系统裁剪 UI"右上角显示为"裁切"等文字,
 *   我们无法控制, 关掉后选完图直接返回, 由本组件用 cover + aspectRatio 做 1:1 展示.
 *
 * 用法:
 *   <ImageUploadField
 *     value={state.image}
 *     onChange={(uri) => dispatch({ type: 'SET_FIELD', payload: { field: 'image', value: uri } })}
 *     label="图片"
 *     height={80}
 *   />
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StatusBar,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

const ImageUploadField = ({
  value,
  onChange,
  label = '图片',
  height = 80,
}) => {
  const [loading, setLoading] = useState(false);
  // 全屏查看图片的开关
  const [zoomed, setZoomed] = useState(false);

  /**
   * 真正调起选图的核心逻辑 (相册 -> 拿 uri -> 回传)
   * 失败时全部走 Alert, 不会静默吞错.
   */
  const pickFromLibrary = useCallback(async () => {
    try {
      // Android 13+ / iOS 都要先申请权限
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          '需要相册权限',
          '请到系统设置中允许访问相册, 才能选择器件图片.'
        );
        return;
      }

      setLoading(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        // 关掉系统裁剪 UI: 各厂商(华为/小米/vivo)相册裁剪按钮文字不可控,
        // 选完图直接返回, 由本组件做 1:1 展示 (resizeMode=cover + aspectRatio=1)
        allowsEditing: false,
        quality: 0.7,
      });

      if (result.canceled) {
        // 用户取消, 不报错
        return;
      }
      if (!result.assets || result.assets.length === 0) {
        return;
      }
      const asset = result.assets[0];
      if (!asset.uri) {
        Alert.alert('选图失败', '未获取到图片地址, 请重试.');
        return;
      }
      onChange?.(asset.uri);
    } catch (err) {
      console.error('[ImageUploadField] 选图异常:', err);
      Alert.alert('选图失败', err?.message || '未知错误, 请重试.');
    } finally {
      setLoading(false);
    }
  }, [onChange]);

  /**
   * 现场拍照 -> 拿 uri -> 回传
   * Android 需要 CAMERA 权限, iOS 自动弹授权.
   */
  const takePhoto = useCallback(async () => {
    try {
      // 先申请相机权限
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          '需要相机权限',
          '请到系统设置中允许使用相机, 才能现场拍摄器件图片.'
        );
        return;
      }

      setLoading(true);
      const result = await ImagePicker.launchCameraAsync({
        // 同上: 关掉系统裁剪 UI
        allowsEditing: false,
        quality: 0.7,
      });

      if (result.canceled) return;
      if (!result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];
      if (!asset.uri) {
        Alert.alert('拍照失败', '未获取到图片地址, 请重试.');
        return;
      }
      onChange?.(asset.uri);
    } catch (err) {
      console.error('[ImageUploadField] 拍照异常:', err);
      Alert.alert('拍照失败', err?.message || '未知错误, 请重试.');
    } finally {
      setLoading(false);
    }
  }, [onChange]);

  /**
   * 点 + 号: 弹出"拍照 / 相册"二选一
   * 用 ActionSheet 风格 (iOS) / Alert.button 风格 (Android)
   * 取消项是必须的, 否则用户没法退出菜单.
   */
  const handleAddPress = useCallback(() => {
    if (loading) return;
    Alert.alert('添加图片', '请选择图片来源', [
      { text: '现场拍照', onPress: takePhoto },
      { text: '从相册选择', onPress: pickFromLibrary },
      { text: '取消', style: 'cancel' },
    ]);
  }, [loading, takePhoto, pickFromLibrary]);

  /**
   * 单击图片区域: 全屏放大查看 (再次单击或返回键关闭)
   */
  const handleImagePress = useCallback(() => {
    if (!value || loading) return;
    setZoomed(true);
  }, [value, loading]);

  /**
   * 删除当前选中的图 (回到 + 状态)
   */
  const handleRemove = useCallback(() => {
    Alert.alert('删除图片', '确定要删除当前选中的图片吗?', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => onChange?.(''),
      },
    ]);
  }, [onChange]);

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <View style={[styles.box, { height }]}>
        {value ? (
          // 已选图: 显示缩略图 + 单击放大 + 右上角删除按钮
          <View style={styles.previewWrap}>
            <Pressable
              style={styles.previewPressable}
              onPress={handleImagePress}
              hitSlop={4}
            >
              <Image
                source={{ uri: value }}
                style={styles.preview}
                resizeMode="cover"
              />
            </Pressable>
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={handleRemove}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.removeBtnText}>×</Text>
            </TouchableOpacity>
          </View>
        ) : (
          // 未选: 显示 + 号
          <TouchableOpacity
            style={styles.placeholder}
            onPress={handleAddPress}
            activeOpacity={0.7}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#999" />
            ) : (
              <Text style={styles.plus}>+</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* 全屏放大查看 Modal: 单击背景/图片/关闭按钮都能退出 */}
      <Modal
        visible={zoomed}
        transparent
        animationType="fade"
        onRequestClose={() => setZoomed(false)}
        statusBarTranslucent
      >
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <Pressable
          style={styles.zoomBackdrop}
          onPress={() => setZoomed(false)}
        >
          <Image
            source={{ uri: value }}
            style={styles.zoomImage}
            resizeMode="contain"
          />
          <TouchableOpacity
            style={styles.zoomClose}
            onPress={() => setZoomed(false)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.zoomCloseText}>×</Text>
          </TouchableOpacity>
          <Text style={styles.zoomHint}>点击任意位置返回</Text>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  box: {
    width: '100%',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
    overflow: 'hidden',
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  plus: {
    fontSize: 40,
    fontWeight: '300',
    color: '#999',
    lineHeight: 40,
    includeFontPadding: false,
  },
  previewWrap: {
    flex: 1,
    position: 'relative',
  },
  previewPressable: {
    width: '100%',
    height: '100%',
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeBtnText: {
    color: 'white',
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '600',
  },

  // 全屏放大查看
  zoomBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomImage: {
    width: '100%',
    height: '100%',
  },
  zoomClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomCloseText: {
    color: 'white',
    fontSize: 24,
    lineHeight: 26,
    fontWeight: '300',
  },
  zoomHint: {
    position: 'absolute',
    bottom: 40,
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 13,
  },
});

export default ImageUploadField;
