import React, { createContext, useContext, useState, useEffect } from 'react';
import StorageService from '../services/StorageService';
import BluetoothHandler from '../services/BluetoothHandler';
import { logError } from '../utils/ErrorHandler';

const UserContext = createContext();

export const UserProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchParams, setSearchParams] = useState({
    searchQuery: '',
    selectedShelf: '',
    advancedSearchParams: {
      name: '',
      category: '',
      function: '',
      resistance: '',
      voltage: '',
      capacitance: '',
      inductance: '',
      current: '',
    },
  });

  useEffect(() => {
    const initApp = async () => {
      try {
        // 始终以 admin 管理员身份自动登录
        const adminUser = { username: 'admin', password: 'admin', isAdmin: true };
        await StorageService.saveLoggedInUser(adminUser);
        setUser(adminUser);
      } catch (error) {
        logError('初始化应用失败', error, 'UserProvider.initApp');
      } finally {
        setIsLoading(false);
      }
    };

    initApp();

    tryAutoConnectBluetooth();
  }, []);

  const tryAutoConnectBluetooth = async () => {
    try {
      const lastDevice = await StorageService.getLastConnectedDevice();
      if (!lastDevice || !lastDevice.deviceId) {
        console.log('没有找到上次连接的蓝牙设备信息');
        return;
      }

      console.log('应用启动时尝试自动连接蓝牙设备:', lastDevice.deviceName);

      const bluetoothHandler = new BluetoothHandler();
      await bluetoothHandler.initialize();

      const connectWithTimeout = Promise.race([
        bluetoothHandler.connectToDevice(lastDevice.deviceId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('连接超时')), 10000)
        ),
      ]);

      const result = await connectWithTimeout;
      if (result.success) {
        console.log('蓝牙自动连接成功:', lastDevice.deviceName);

        global.deviceConnection = {
          type: 'bluetooth',
          device: { id: lastDevice.deviceId, name: lastDevice.deviceName },
          handler: bluetoothHandler,
        };
      }
    } catch (error) {
      console.log('蓝牙自动连接失败:', error.message);
    }
  };

  const login = async (userData) => {
    try {
      await StorageService.saveLoggedInUser(userData);
      setUser(userData);
    } catch (error) {
      logError('登录失败', error, 'UserProvider.login');
      throw error;
    }
  };

  const logout = async () => {
    try {
      await StorageService.removeLoggedInUser();
      setUser(null);
      // 退出登录时重置搜索参数
      setSearchParams({
        searchQuery: '',
        selectedShelf: '',
        advancedSearchParams: {
          name: '',
          category: '',
          function: '',
          resistance: '',
          voltage: '',
          capacitance: '',
          inductance: '',
          current: '',
        },
      });
    } catch (error) {
      logError('退出登录失败', error, 'UserProvider.logout');
      throw error;
    }
  };

  const updateUser = async (updatedUser) => {
    try {
      await StorageService.saveLoggedInUser(updatedUser);
      setUser(updatedUser);
    } catch (error) {
      logError('更新用户信息失败', error, 'UserProvider.updateUser');
      throw error;
    }
  };

  const updateSearchParams = (newParams) => {
    setSearchParams((prev) => ({ ...prev, ...newParams }));
  };

  const clearSearchParams = () => {
    setSearchParams({
      searchQuery: '',
      selectedShelf: '',
      advancedSearchParams: {
        name: '',
        category: '',
        function: '',
        resistance: '',
        voltage: '',
        capacitance: '',
        inductance: '',
        current: '',
      },
    });
  };

  if (isLoading) {
    return null;
  }

  return (
    <UserContext.Provider
      value={{
        user,
        login,
        logout,
        updateUser,
        searchParams,
        updateSearchParams,
        clearSearchParams,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};

export default UserContext;