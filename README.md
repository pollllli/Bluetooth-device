# 器件管理系统 (Bluetooth-device)

> 基于 React Native + Expo (SDK 55) 的 Android 移动应用，管理电子器件库存与 BOM 配单，通过蓝牙控制下位机指示灯，实现"扫码/查BOM/取器件/灭灯"全流程闭环。

## 目录

- [概述](#概述)
- [核心功能](#核心功能)
- [使用方法](#使用方法)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [通信协议](#通信协议)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
- [更新日志](#更新日志)

## 概述

器件管理系统是一个**多库存**移动管理 App，每个库存（器件架）可独立绑定一个蓝牙模块（CH9140，名称前缀 `W02_`）。在某个库存下连接蓝牙后，该 MAC 自动绑定为该库存的匹配蓝牙；切换库存时自动重连或断开。

通过蓝牙向 MCU 下位机发送 7 字节指令帧（0x55 0xAA + 命令字 + 数据），控制每个位置的指示灯亮/灭，辅助人工快速定位/取出器件。

应用以管理员身份自动登录，无需注册，所有功能（新建/删除/导入/导出）均可直接使用。

底部 4 个常驻 Tab：**库存、连接、BOM匹配、设置**。

## 核心功能

### 1. 多库存管理
- 新装零库存，需用户自行新建
- 创建/重命名/删除库存（连同其下所有器件）
- 库存间一键切换（底栏面板）
- 每个库存独立绑定蓝牙模块
- 库存管理列表显示蓝牙绑定徽章
- 零库存时 4 个 tab 全部常驻可点，带黄色提示条引导新建

### 2. 器件管理
- 名称/功能/编号/封装/分类/位置/备注多维度管理
- 搜索（名称/功能/编号）+ 器件架筛选（A/B/C/D）
- 点击器件卡片切换亮/灭灯
- **左滑**卡片调出"编辑"/"删除"按钮
- 新建/批量导入（Excel/CSV）/扫码导入（条码识别后自动上架第一个空位）
- 位置选择器直观显示已占用与空位

### 3. BOM 配单
- 导入 Excel/CSV BOM
- 加载/删除已保存的 BOM
- 器件状态显示：库存充足绿色、不足橙色
- 点击绿色（已匹配）条目切换亮/灭灯（支持一个 BOM 条目匹配多个器件）
- 清空 BOM（同步熄灭所有灯）
- 外部 App 打开 Excel/CSV 自动跳转 BOM 页导入

### 4. 数据管理
- 导出为 JSON 文件，**文件名 = 库存名**
- 应用内导入（设置页选择文件）
- 外部 App 导入（微信/QQ/文件管理器分享）
- **按文件名匹配**：同名覆盖/异名新增
- 导入后自动切库 + 自动连接蓝牙（10 秒超时）
- 大 JSON 流式导入（分块读取，内存峰值低）

### 5. 蓝牙连接（仅 W02_ 前缀设备）
- **只扫描 `W02_` 开头的蓝牙模块**（过滤其他蓝牙设备）
- **波特率固定 9600**（CH9140 出厂默认，连接后心跳验证）
- 库存自动绑定蓝牙 MAC
- 切库自动重连/断开
- 5 秒内扫不到目标 → "蓝牙不在范围"提示
- 连接状态徽章（库存页右上角）
- 一键点亮所有/熄灭所有灯（`fastControlAll`，1.5 秒硬超时）

## 使用方法

### 1. 快速开始
1. 安装 APK
2. 打开应用，自动以管理员身份登录
3. 进入"设置 → 库存管理"，点击"+ 添加库存"创建第一个库存
4. 进入"连接"页，扫描 `W02_` 蓝牙模块并连接
5. 进入"库存"页，开始添加器件

### 2. 亮灯/灭灯操作
- **库存页**：直接点击器件卡片切换亮/灭灯
- **BOM 页**：点击绿色（已匹配）的 BOM 条目切换亮/灭灯
- **所有灯**：库存页底部"点亮所有灯"/"熄灭所有灯"按钮

### 3. 编辑/删除器件
在器件卡片上**左滑**，出现"编辑"和"删除"按钮。

### 4. 数据导入/导出
- 导出：设置 → 数据导出 → 选库存 → 保存为 `<库存名>.json`
- 导入：设置 → 数据导入 → 选 JSON 文件
- 外部：微信/QQ/文件管理器打开导出的 JSON → 选择本 App → 自动识别

## 技术栈

| 分类 | 技术/库 | 说明 |
|---|---|---|
| 开发框架 | React Native 0.83 + Expo SDK 55 | 跨平台移动应用 |
| 导航 | React Navigation (Bottom Tabs + Stack) | Tab + Stack 导航 |
| 主数据存储 | expo-sqlite (SQLite) | 器件/库存/分类等主数据，含 schema 迁移 |
| KV 存储 | @react-native-async-storage/async-storage | 轻量状态；SQLite 失败时兜底 |
| 数据库迁移 | migration.js | schema 版本演进，自动迁移旧数据 |
| 蓝牙通信 | react-native-ble-plx | BLE 通信，波特率固定 9600 |
| 相机/扫码 | expo-camera (CameraView) | 条码扫描（QR/EAN13/Code128 等） |
| 音频 | expo-av | 扫码提示音 |
| 图片选择 | expo-image-picker | 从相册选器件图片 |
| 剪贴板 | expo-clipboard | 复制器件编号 |
| 文件分享 | react-native-share + expo-sharing | 微信/QQ/邮件分享 JSON |
| 文件选择 | expo-document-picker | 选 Excel/CSV/JSON |
| 文件系统 | expo-file-system + expo-easy-fs | 文件读写、沙盒图片缓存 |
| 外部文件接收 | Expo Linking（内置） | 接收外部 App 打开的文件 |
| Excel/CSV 解析 | xlsx | Excel/CSV 解析 |
| 流式 JSON 解析 | streamJsonImport.js（自实现） | 分块读取大 JSON |
| 命令帧 | CommandBuilder | 自定义 7 字节串口协议 |
| 库存管理 | ShelfService | 多库存、绑定关系、事件订阅 |
| 分类管理 | DeviceCategoryService | 分类树形结构 |
| 亮灯状态 | lightStatusStore + lightEvents | 跨页面集中式亮灯状态（唯一权威源） |
| 快速灭灯 | fastControlAll() | 1.5s 超时不等 ACK，BLE 挂起时不卡 |
| 自动重连 | autoConnectBluetooth | 切库/导入后自动后台重连 |
| 手势操作 | react-native-gesture-handler + SwipeableRow | 左滑编辑/删除 |
| 错误隔离 | ErrorBoundary | 组件级异常边界 |

## 快速开始

### 开发环境

```bash
# 1. 克隆仓库
git clone https://github.com/pollllli/Bluetooth-device.git

# 2. 进入主项目
cd StableDeviceApp

# 3. 安装依赖
npm install

# 4. 启动开发服务器
npx expo start
```

### 发布版

1. 下载 `app-release.apk` 安装到 Android 设备
2. 进入"设置 → 库存管理"新建第一个库存

## 通信协议

### 命令帧格式（7 字节）

```
[55] [AA] [CMD] [LEN] [DATA_H] [DATA_L] [CRC]
  ↑    ↑    ↑     ↑      ↑       ↑       ↑
帧头 帧头 命令字 数据长度 数据高字节 数据低字节 CRC-8/MAXIM
```

### 支持的命令

| 命令字 | 功能 | 数据 |
|---|---|---|
| 0x00 | 心跳 | uint16 (0x0001) |
| 0x01 | 点亮对应灯 | uint16 (灯 ID 1-255) |
| 0x02 | 熄灭对应灯 | uint16 (灯 ID 1-255) |
| 0x03 | 控制所有灯 | uint16 (0xFFFF=亮, 0x0000=灭) |

### 响应帧

响应命令字 = 发送命令字 + 0x80

### UART 波特率

| 波特率 | 适用 |
|---|---|
| 9600 | CH9140 出厂默认，应用锁定使用 |

应用连接后自动心跳验证，确保蓝牙模块与 MCU 波特率一致。

完整协议见 [PROTOCOL.md](StableDeviceApp/PROTOCOL.md)。

## 项目结构

```
Bluetooth-device/
├── StableDeviceApp/                  ← 主项目 (React Native + Expo SDK 55)
│   ├── src/
│   │   ├── components/               # UI 组件 (SwipeableRow, ImageUploadField, ErrorBoundary)
│   │   ├── context/                  # React Context (UserContext)
│   │   ├── navigation/               # 导航 (AppNavigator)
│   │   ├── screens/                  # 9+1 个页面
│   │   │   ├── DeviceListScreen.js       # 库存（主屏，点击卡片切换亮/灭灯）
│   │   │   ├── ConnectionScreen.js       # 连接（蓝牙扫描/连接）
│   │   │   ├── BOMScreen.js              # BOM 匹配
│   │   │   ├── ProfileScreen.js          # 设置（数据导入/导出、库存/分类管理入口）
│   │   │   ├── AdminEditScreen.js        # 编辑器件（左滑调出）
│   │   │   ├── NewDeviceScreen.js        # 新建器件
│   │   │   ├── ScanScreen.js             # 扫码导入
│   │   │   ├── ShelfManagerScreen.js     # 库存管理
│   │   │   ├── CategoryManagementScreen.js # 分类管理
│   │   │   └── DeviceDetailScreen.js     # 器件详情（文件保留，已无入口，遗留代码）
│   │   ├── services/                 # 服务层
│   │   │   ├── CommandBuilder.js         # 命令帧
│   │   │   ├── BluetoothHandler.js       # 蓝牙（含 fastControlAll）
│   │   │   ├── StorageService.js         # 数据存储（SQLite 主 + AsyncStorage 双写）
│   │   │   ├── ShelfService.js           # 库存 CRUD + 事件订阅
│   │   │   ├── DeviceCategoryService.js  # 分类管理
│   │   │   ├── database.js               # SQLite 连接初始化
│   │   │   └── migration.js              # SQLite schema 迁移
│   │   └── utils/                    # 工具函数
│   │       ├── streamJsonImport.js       # 大 JSON 流式导入
│   │       ├── positionUtils.js          # 位置计算
│   │       ├── lightStatusStore.js       # 集中式亮灯状态
│   │       ├── lightEvents.js            # 亮灯事件总线
│   │       ├── autoConnectBluetooth.js   # 自动重连
│   │       ├── pendingAutoConnect.js     # 待连接 MAC 传递
│   │       ├── pendingBomImport.js       # 待导入 BOM 传递
│   │       ├── StorageUtils.js
│   │       ├── SearchUtils.js
│   │       └── ErrorHandler.js
│   ├── android/                      # Android 原生工程
│   ├── assets/                       # 资源文件
│   ├── tools/                        # 构建/调试脚本
│   ├── app.json
│   ├── package.json
│   ├── PROTOCOL.md                   # 通信协议文档
│   ├── ARCHITECTURE.md               # 架构设计
│   ├── API.md                        # API 文档
│   └── README.md                     # 完整项目说明
├── crawler_server.py                 # 辅助工具（独立爬虫，与 App 无关）
└── README.md                         # 本文件
```

## 常见问题

### Q1: 蓝牙扫描不到设备？
本 App **只扫描 `W02_` 开头的蓝牙模块**，其他设备被过滤。如果你的模块名称不符，需在厂商工具里改名，或修改 `BluetoothHandler.js` 的 `startsWith('W02_')` 条件。

### Q2: 蓝牙连接失败？
1. 蓝牙已开启
2. `W02_` 模块在范围内
3. 模块 UART 波特率 = **9600**（与 MCU 一致）
4. 重启 App 后重试

### Q3: 切库后旧库存灯没灭？
已修复（v1.2.2）：走 `fastControlAll` 1.5s 超时不等 ACK，即使 BLE 链路被 OS 挂起也能快速灭灯。

### Q4: 灯不亮？
1. 检查库存页右上角徽章（已连接/未连接）
2. 设置 → 库存管理查看蓝牙绑定
3. 器件位置是否正确
4. 重新发送指令

### Q5: 数据丢失？
用"设置 → 数据导入"恢复（应用内或外部 App 打开）。**建议定期导出备份**。

### Q6: 微信分享的 JSON 打不开？
1. 确认扩展名为 `.json`
2. 分享时选择"用其他应用打开"→ 选择本应用
3. 如失败，先保存到本地，再通过"设置 → 数据导入"选择

### Q7: 扫码后位置选择器取消了灯灭了？
v1.6.9 已修复：取消位置选择器会自动重新点亮第一个空位置的灯。

## 更新日志

### v1.6.9 (2026-08-12)
- 修复扫码位置选择器取消后第一个空位置灯熄灭的问题

### v1.6.8 (2026-08-11)
- **流式 JSON 导入**：大文件分块读取实时解析，内存峰值低
- 修复流式解析下分类字段丢失问题
- 500 器件大文件导入测试通过

### v1.6.5 (2026-08-03)
- BOM 匹配不再校验封装
- 嘉立创模板 Comment 列正确识别为器件名称
- 微信/QQ/文件管理器接收文件自动跳转 App
- 导入后自动连蓝牙超时改为 10s
- 修复切库时器件显示为 0 个的问题

### v1.4.0 (2026-07)
- **架构升级**：主数据从 AsyncStorage 迁移到 expo-sqlite（SQLite），性能大幅提升
- 分类管理（树形结构）
- 数据库 migration 框架
- 流式 JSON 导入

### v1.2.3 (2026-07-07)
- 蓝牙扫描过滤 `W02_` 前缀
- 移除"上次运行出现错误"误报弹窗

### v1.2.2 (2026-07-07)
- `lightStatusStore` 集中式亮灯状态（跨页面唯一权威源）
- `fastControlAll()` 1.5s 超时快速灭灯
- 切库优先快速灭灯，BLE 挂起不卡死
- 修复 BOM 绿底残留、切库旧灯不灭、vivo UI 消失等问题

### v1.2.1 (2026-07-03)
- 零库存时 4 个 tab 全部常驻可点
- "连接"/"BOM匹配"零库存提示条引导

### v1.2.0 (2026-07-03)
- 多库存管理、新装零库存、外部 App 导入
- 蓝牙自动绑定/重连、"不在范围"提示
- **波特率固定 9600**
- 库存管理页

### v1.0.2 (2026-05-28)
- 取消登录注册（自动管理员登录）
- 删除电气参数、串口模拟
- 数据备份改为数据导出/导入
- 扫码逻辑优化

### v1.0.0 (2026-05-13)
- 初始版本

---

## 许可证

MIT License
