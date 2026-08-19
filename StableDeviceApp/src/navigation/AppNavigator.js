import React from 'react';
import { Image, View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
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
import colors from '../theme/colors';
import RaisedShadow from '../components/RaisedShadow';

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

// 渲染 tab 图标: 用 assets/tab-icons 下的本地 PNG (require 静态资源)
// 激活时轻微放大+满色, 未激活时正常+淡色
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
    opacity: 0.4, // 未激活时淡一点
  },
  iconFocused: {
    width: 28,
    height: 28,
    opacity: 1, // 激活时满色
  },
});

/**
 * TabBarInner - 包一层 BottomTabBar
 * 显式传 baseStyle (我们的圆角+同色+height:64), 忽略 props.style,
 * 避免 RN 内部透传的 tabBarStyle 覆盖我们的关键属性 (height/backgroundColor/borderRadius)
 */
const TabBarInner = (props) => (
  <BottomTabBar {...props} style={props.baseStyle} />
);

// 主标签导航
const MainTabNavigator = () => {
  const { user } = useUser();
  const isAdmin = user?.isAdmin || false;
  const username = user?.username || 'user';

  // 4 个 tab 全部常驻: 0 库存时也允许用户进"连接"和"BOM"页,
  // 由页内空状态提示"当前无库存, 请先新建或导入库存".

  // 大圆角悬浮导航框: 与页面同色, 左上亮色高光棱 + 右下深色软落影 (光源左上)
  // Neumorphism 风格: 外阴影极弱, 凸起感完全由内部边缘渐变承担
  const tabBarContainerStyle = {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    height: 64,                  // 显式兜底, 防止内部任何组件塌缩导致整条链消失
    borderRadius: 28,            // 大圆角
    overflow: 'hidden',
    backgroundColor: colors.bg,   // 与页面同色 (Android 投影也需要非透明背景)
    // iOS 方向性外阴影 (轻微右下投影, 营造"略高于背景"的浮起感, 不抢内部高光的戏)
    shadowColor: colors.shadow,
    shadowOffset: { width: 2, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    // Android 上浮
    elevation: 4,
  };

  // 内部 BottomTabBar 样式: 与外层 RaisedShadow 同色同圆角, 保持视觉连续
  const baseTabBarStyle = {
    backgroundColor: colors.bg,   // 与外层 RaisedShadow 容器同色, 避免矩形色块感
    borderTopWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderRadius: 28,            // 与外层一致, 消除"内方外圆"的割裂感
    height: 64,                  // 显式高度, 撑起整条 BottomTabBar
    paddingBottom: 8,
    paddingTop: 8,
  };

  return (
    <Tab.Navigator
      tabBar={(props) => (
        <View style={tabBarContainerStyle} pointerEvents="box-none">
          <RaisedShadow
            backgroundColor={colors.bg}
            borderRadius={28}
            inset={8}
          >
            <TabBarInner {...props} baseStyle={baseTabBarStyle} />
          </RaisedShadow>
        </View>
      )}
      screenOptions={{
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        // 用 baseTabBarStyle, 不要用 display:none —— 那样会让 BottomTabBar 高度塌成 0
        // 真实渲染由自定义 tabBar prop 接管, 这里只是给 BottomTabBar 一个合理默认 style
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
        }}
      />
      <Tab.Screen
        name="BOM"
        options={{
          title: 'BOM匹配',
          tabBarTestID: 'tab-bom',
          tabBarIcon: renderTabIcon(require('../../assets/tab-icons/bom.png')),
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
            backgroundColor: colors.headerBg,
            elevation: 0,
            shadowOpacity: 0,
            borderBottomWidth: 1,
            borderBottomColor: colors.headerBorder,
          },
          headerTintColor: colors.headerText,
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
                <Text style={{ color: colors.headerText, fontSize: 18 }}>←</Text>
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