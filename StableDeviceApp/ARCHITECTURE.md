# 应用架构设计

## 架构概述

本应用采用React Native + Expo框架开发，使用了以下架构模式：

- **组件化架构**：将UI拆分为可复用的组件
- **状态管理**：使用React的useState、useReducer等hooks进行状态管理
- **服务层**：将业务逻辑和数据操作封装在服务中
- **工具函数**：将通用功能提取为工具函数
- **导航系统**：使用React Navigation进行页面导航

## 目录结构

```
StableDeviceApp/
├── src/
│   ├── components/         # 可复用组件
│   ├── navigation/         # 导航配置
│   ├── screens/            # 页面组件
│   ├── services/           # 服务层
│   └── utils/              # 工具函数
├── App.tsx                 # 应用入口
├── package.json            # 依赖配置
├── tsconfig.json           # TypeScript配置
└── README.md               # 项目文档
```

## 核心模块

### 1. 导航系统

- **AppNavigator**：应用的主导航配置，管理登录状态和路由
- **MainTabNavigator**：主标签导航，包含库存、连接、BOM配单和个人中心

### 2. 页面组件

- **LoginScreen**：登录和注册页面
- **DeviceListScreen**：器件库存列表页面
- **DeviceDetailScreen**：器件详情页面
- **AdminEditScreen**：器件编辑和上架页面
- **BOMScreen**：BOM配单页面
- **ProfileScreen**：个人中心页面
- **ConnectionScreen**：蓝牙连接页面

### 3. 服务层

- **StorageService**：本地存储服务，处理数据的读写操作
- **BluetoothHandler**：蓝牙通信服务，处理与蓝牙设备的通信
- **CommandBuilder**：命令构建服务，构建发送给蓝牙设备的命令

### 4. 工具函数

- **ErrorHandler**：错误处理工具，统一处理和记录错误
- **StorageUtils**：存储工具，提供统一的存储操作接口
- **SearchUtils**：搜索工具，处理搜索相关的逻辑

### 5. 可复用组件

- **LoadingError**：加载状态和错误提示组件

## 数据流

### 数据存储

- 使用AsyncStorage进行本地数据存储
- 数据结构包括：器件、用户、BOM配单、搜索历史等
- 提供数据备份和恢复功能

### 数据流动

1. **用户操作**：用户在UI上进行操作
2. **状态更新**：组件状态更新，触发重新渲染
3. **服务调用**：调用服务层方法处理业务逻辑
4. **数据持久化**：服务层将数据保存到存储
5. **状态同步**：组件从存储中读取最新数据

## 权限管理

- **普通用户**：只能查看器件和BOM配单，不能修改数据
- **管理员**：可以添加、编辑、删除器件和BOM配单，导入数据
- 权限检查在每个需要权限的操作中进行

## 蓝牙通信

- 使用react-native-ble-plx库进行蓝牙通信
- 支持连接到蓝牙设备，发送器件请求命令
- 命令格式：JSON格式，包含命令类型和参数

## 性能优化

- **组件优化**：使用useMemo、useCallback等hooks减少不必要的渲染
- **存储优化**：批量读写操作，减少存储访问次数
- **搜索优化**：使用过滤和缓存提高搜索性能

## 安全性

- **数据验证**：验证输入数据的有效性
- **错误处理**：完善的错误处理机制
- **权限控制**：基于角色的权限管理

## 未来扩展

- **云同步**：添加云存储和同步功能
- **多语言支持**：添加国际化支持
- **主题系统**：支持浅色/深色主题
- **更多设备类型**：支持更多类型的蓝牙设备
- **数据分析**：添加数据分析和统计功能

## 技术栈

- **前端框架**：React Native + Expo
- **状态管理**：React Hooks
- **导航**：React Navigation
- **存储**：AsyncStorage
- **蓝牙**：react-native-ble-plx
- **文件处理**：expo-document-picker
- **Excel/CSV处理**：xlsx
- **代码质量**：ESLint + Prettier + TypeScript
