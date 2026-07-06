import React from 'react';
import { Image, View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import DeviceListScreen from '../screens/DeviceListScreen';
import DeviceDetailScreen from '../screens/DeviceDetailScreen';
import AdminEditScreen from '../screens/AdminEditScreen';
import NewDeviceScreen from '../screens/NewDeviceScreen';
import BOMScreen from '../screens/BOMScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ConnectionScreen from '../screens/ConnectionScreen';
import ScanScreen from '../screens/ScanScreen';
import CategoryManagementScreen from '../screens/CategoryManagementScreen';
import ShelfManagerScreen from '../screens/ShelfManagerScreen';
import { useUser } from '../context/UserContext';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

/**
 * 全局导航引用：用于在 React 组件树之外执行导航操作
 * （如 App.tsx 中收到外部应用分享的 JSON 文件后，导入成功时需跳回主页）
 */
export const navigationRef = createNavigationContainerRef();

const sendLightOff = async () => {
  if (global.deviceConnection && global.deviceConnection.handler) {
    try {
      await global.deviceConnection.handler.sendCommand({ type: 'lightOff', lightId: 0 });
    } catch (error) {
      console.log('熄灯失败:', error);
    }
  }
};

// 渲染 tab 图标：彩色实心图
// 激活时轻微放大 + 加阴影，未激活时正常
const renderTabIcon = (iconSource) => ({ focused }) => (
  <View style={tabIconStyles.wrapper}>
    <Image
      source={iconSource}
      style={[
        tabIconStyles.icon,
        focused && tabIconStyles.iconFocused,
      ]}
      resizeMode="contain"
    />
  </View>
);

const tabIconStyles = StyleSheet.create({
  wrapper: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 24,
    height: 24,
    opacity: 0.6, // 未激活时淡一点
  },
  iconFocused: {
    width: 28,
    height: 28,
    opacity: 1, // 激活时满色
  },
});

// 主标签导航
const MainTabNavigator = () => {
  const { user } = useUser();
  const isAdmin = user?.isAdmin || false;
  const username = user?.username || 'user';

  // 4 个 tab 全部常驻, 库存数影响由 ConnectionScreen / BOMScreen 自己监听处理

  // 关键: 共享的 tabBarStyle, 所有 tab 必须用同一个, 高度才不会切 tab 时跳变
  // 之前 Connection/BOM 用 `tabBarStyle: hasShelves ? undefined : { display: 'none' }`,
  // undefined 在 React Navigation v5 里被当「清空样式」, 不会回退到 screenOptions.tabBarStyle,
  // 导致这俩 tab 用了平台默认高度 49 (系统默认). 库存/设置 没踩这个坑是因为它们没设 tabBarStyle
  const baseTabBarStyle = {
    backgroundColor: '#f5f5f5',
    borderTopWidth: 1,
    borderTopColor: '#ddd',
    height: 60,
    paddingBottom: 4,
  };
  // 4 个 tab 全部常驻: 0 库存时也允许用户进"连接"和"BOM"页,
  // 由页内空状态提示"当前无库存, 请先新建或导入库存".
  // 不要再用 tabBarButton: () => null 隐藏 tab — 那种会偷走用户入口

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: baseTabBarStyle,
        tabBarLabelStyle: {
          fontSize: 14,
        },
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="DeviceListTab"
        options={{
          title: '库存',
          tabBarTestID: 'tab-inventory',
          tabBarIcon: renderTabIcon(require('../../assets/tab-icons/inventory.png')),
        }}
      >
        {(props) => <DeviceListScreen {...props} isAdmin={isAdmin} />}
      </Tab.Screen>
      <Tab.Screen
        name="Connection"
        component={ConnectionScreen}
        options={{
          title: '连接',
          tabBarTestID: 'tab-connection',
          tabBarIcon: renderTabIcon(require('../../assets/tab-icons/bluetooth.png')),
          tabBarStyle: baseTabBarStyle,
        }}
      />
      <Tab.Screen
        name="BOM"
        options={{
          title: 'BOM匹配',
          tabBarTestID: 'tab-bom',
          tabBarIcon: renderTabIcon(require('../../assets/tab-icons/bom.png')),
          tabBarStyle: baseTabBarStyle,
        }}
      >
        {(props) => <BOMScreen {...props} isAdmin={isAdmin} />}
      </Tab.Screen>
      <Tab.Screen
        name="Profile"
        options={{
          title: '设置',
          tabBarTestID: 'tab-profile',
          tabBarIcon: renderTabIcon(require('../../assets/tab-icons/profile.png')),
        }}
      >
        {(props) => (
          <ProfileScreen
            {...props}
            route={{
              ...props.route,
              params: {
                ...props.route.params,
                username,
                isAdmin,
              },
            }}
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
};

/**
 * 应用主导航组件
 * 负责管理应用的路由配置
 */
const AppNavigator = () => {
  const { user } = useUser();
  const isAdmin = user?.isAdmin || true;

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        initialRouteName="MainTabs"
        screenOptions={{
          headerStyle: {
            backgroundColor: '#f5f5f5',
            elevation: 0,
            shadowOpacity: 0,
            borderBottomWidth: 1,
            borderBottomColor: '#e0e0e0',
          },
          headerTintColor: '#333',
          headerTitleStyle: {
            fontWeight: '600',
            fontSize: 18,
          },
          headerBackTitleVisible: false,
          headerLeftContainerStyle: {
            paddingLeft: 8,
          },
          transitionSpec: {
            open: {
              animation: 'timing',
              config: {
                duration: 300,
              },
            },
            close: {
              animation: 'timing',
              config: {
                duration: 300,
              },
            },
          },
        }}
      >
        <Stack.Screen name="MainTabs" options={{ headerShown: false }}>
          {(props) => <MainTabNavigator {...props} />}
        </Stack.Screen>
        <Stack.Screen
          name="DeviceDetail"
          component={DeviceDetailScreen}
          options={{
            title: '器件详情',
            headerBackTitle: '返回',
          }}
        />
        <Stack.Screen
          name="AdminEdit"
          component={AdminEditScreen}
          options={({ route }) => ({
            title: route.params?.isNew ? '上架器件' : '编辑器件',
            headerBackTitle: '返回',
          })}
        />
        <Stack.Screen
          name="NewDevice"
          component={NewDeviceScreen}
          options={{
            title: '新建器件',
            headerBackTitle: '返回',
          }}
        />
        <Stack.Screen
          name="ScanScreen"
          component={ScanScreen}
          options={({ navigation }) => ({
            title: '扫码导入',
            headerBackTitle: '返回',
            headerLeft: () => (
              <TouchableOpacity
                style={{ paddingLeft: 8 }}
                onPress={() => {
                  sendLightOff();
                  navigation.navigate('MainTabs', { screen: 'DeviceListTab' });
                }}
              >
                <Text style={{ color: '#333', fontSize: 16 }}>← 返回</Text>
              </TouchableOpacity>
            ),
          })}
        />
        <Stack.Screen
          name="CategoryManagement"
          component={CategoryManagementScreen}
          options={{
            title: '分类管理',
            headerBackTitle: '返回',
          }}
        />
        <Stack.Screen
          name="ShelfManager"
          component={ShelfManagerScreen}
          options={{
            title: '库存管理',
            headerBackTitle: '返回',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;