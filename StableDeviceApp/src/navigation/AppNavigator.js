import React from 'react';
import { Image, View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import DeviceListScreen from '../screens/DeviceListScreen';
import DeviceDetailScreen from '../screens/DeviceDetailScreen';
import AdminEditScreen from '../screens/AdminEditScreen';
import BOMScreen from '../screens/BOMScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ConnectionScreen from '../screens/ConnectionScreen';
import ScanScreen from '../screens/ScanScreen';
import CategoryManagementScreen from '../screens/CategoryManagementScreen';
import { useUser } from '../context/UserContext';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

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

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: {
          backgroundColor: '#f5f5f5',
          borderTopWidth: 1,
          borderTopColor: '#ddd',
          height: 60,
        },
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
          title: 'BOM配单',
          tabBarTestID: 'tab-bom',
          tabBarIcon: renderTabIcon(require('../../assets/tab-icons/bom.png')),
        }}
      >
        {(props) => <BOMScreen {...props} isAdmin={isAdmin} />}
      </Tab.Screen>
      <Tab.Screen
        name="Profile"
        options={{
          title: '我的',
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
    <NavigationContainer>
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
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;