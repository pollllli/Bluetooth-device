import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AppNavigator from './src/navigation/AppNavigator';
import { UserProvider } from './src/context/UserContext';

export default function App() {
  return (
    // 必须用 GestureHandlerRootView 包裹根组件
    // 否则 react-native-gesture-handler 的 Swipeable/Pressable 等手势组件无法识别手势
    // flex: 1 必传, 否则 Android 上会白屏
    <GestureHandlerRootView style={{ flex: 1 }}>
      <UserProvider>
        <AppNavigator />
        <StatusBar style="auto" />
      </UserProvider>
    </GestureHandlerRootView>
  );
}
