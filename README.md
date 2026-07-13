# 器件管理系统 (Bluetooth-device)

> 基于 React Native + Expo 的 Android 移动应用,管理电子器件库存与 BOM 配单,通过蓝牙控制下位机指示灯,实现"扫码/查 BOM/取器件/灭灯"全流程闭环。

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

器件管理系统是一个**多库存**移动管理 App,每个库存(器件架)可独立绑定一个蓝牙模块(CH9140)。在某个库存下连接蓝牙后,该 MAC 自动绑定为该库存的匹配蓝牙;切换库存时自动重连或断开。

通过蓝牙向 MCU 下位机发送 7 字节指令帧(0x55 0xAA + 命令字 + 数据),控制每个位置的指示灯亮/灭,辅助人工快速定位/取出器件。

应用以管理员身份自动登录,无需注册,所有功能(新建/删除/导入/导出)均可直接使用。

## 核心功能

### 1. 多库存管理
- 新装零库存,需用户自行新建
- 创建/重命名/删除库存(连同其下所有器件)
- 库存间一键切换
- 每个库存独立绑定蓝牙模块
- 库存管理列表显示蓝牙绑定徽章
- 零库存时 4 个 tab 全部常驻可点,带 ⚠️ 提示条引导新建

### 2. 器件管理
- 名称/功能/编号/封装/分类/位置/备注多维度管理
- 搜索(名称/功能/编号)+ 器件架筛选(A/B/C/D)
- 新建/编辑/删除/批量导入(Excel/CSV)
- 扫码导入(扫码后直接上架到第一个空位置,可选指定位置)
- 位置选择器直观显示已占用与空位

### 3. BOM 配单
- 导入 Excel/CSV BOM
- 加载/删除已保存的 BOM
- 器件状态显示:库存充足绿色、不足橙色
- 点击绿色器件发送蓝牙指令点亮对应位置
- BOM 清空功能(同步清空灯状态)

### 4. 器件请求与取出
- 库存页点单个器件 → 点亮该位置
- 库存页/详情页点"请求此器件"/"取出器件"
- 一键点亮所有/熄灭所有灯

### 5. 数据管理
- 导出为 JSON 文件,**文件名 = 库存名**
- 应用内导入(个人中心选择文件)
- 外部 App 导入(微信/QQ/邮件分享)
- **按文件名匹配**:同名覆盖/异名新增
- 导入后自动切库 + 自动连接蓝牙

### 6. 蓝牙连接(仅 W02_ 前缀设备)
- **只扫描 `W02_` 开头的蓝牙模块**(过滤其他蓝牙设备)
- 多波特率自适应(9600/115200 自动探测)
- 库存自动绑定蓝牙 MAC
- 切库自动重连/断开
- 5 秒内扫不到目标 → "蓝牙不在范围"提示
- 连接状态徽章(库存页右上角)

## 使用方法

### 1. 快速开始
1. 安装 APK
2. 打开应用,自动以管理员身份登录
3. 进入"设置 → 库存管理",点击"+ 添加库存"创建第一个库存
4. 进入"连接"页,扫描 `W02_` 蓝牙模块并连接
5. 进入"库存"页,开始添加器件

### 2. 库存切换
库存首页底栏弹出"切换库存"面板,选择目标库存:
- 已绑定蓝牙 → 自动重连
- 未绑定蓝牙 → 断开当前连接,提示手动连接

### 3. BOM 配单
1. 进入"BOM 匹配"页
2. 点"导入 BOM 文件",选择 Excel/CSV
3. 系统自动识别器件并标注状态
4. 点绿色器件 → 蓝牙点亮对应位置
5. 取完器件后点"取出器件"灭灯
6. 用完点"清空 BOM"释放所有灯

### 4. 数据导入/导出
- 导出:个人中心 → 数据导出 → 选库存 → 保存为 `<库存名>.json`
- 导入:个人中心 → 数据导入 → 选 JSON 文件
- 外部:微信/QQ 打开导出的 JSON → 选择本 App → 自动识别

## 技术栈

| 分类 | 技术/库 | 说明 |
|---|---|---|
| 开发框架 | React Native + Expo | 跨平台移动应用 |
| 导航 | React Navigation | Tab + Stack 导航 |
| 数据存储 | AsyncStorage | 本地数据持久化 |
| 蓝牙通信 | react-native-ble-plx | BLE 通信 |
| 文件处理 | Expo DocumentPicker | 文件选择 |
| 文件分享 | Expo Sharing | 文件保存/分享 |
| 外部文件接收 | Expo Linking | 接收外部 App 打开的文件 |
| Excel/CSV 解析 | xlsx | Excel 文件解析 |
| 命令帧 | CommandBuilder | 自定义串口协议 |
| 库存管理 | ShelfService | 多库存、绑定关系、事件订阅 |
| 亮灯状态 | lightStatusStore + lightEvents | 跨页面集中式亮灯状态 |
| 快速灭灯 | fastControlAll | 1.5s 超时不等 ACK |
| 自动重连 | autoConnectBluetooth | 切库/导入后自动后台重连 |

## 快速开始

### 开发环境

```bash
# 1. 克隆仓库
git clone https://github.com/pollllli/Bluetooth-device.git

# 2. 进入主项目
cd Bluetooth-device/StableDeviceApp

# 3. 安装依赖
npm install

# 4. 启动开发服务器
npx expo start
```

### 发布版

1. 下载 `app-release.apk` (138.49 MB)
2. 直接安装到 Android 设备
3. 进入"设置 → 库存管理"新建第一个库存

## 通信协议

### 命令帧格式(7 字节)

```
[55] [AA] [CMD] [LEN] [DATA_H] [DATA_L] [CRC]
  ↑    ↑    ↑     ↑      ↑       ↑       ↑
帧头  帧头 命令字 数据长度 数据高字节 数据低字节 CRC-8/MAXIM
```

### 支持的命令

| 命令字 | 功能 | 数据 |
|---|---|---|
| 0x00 | 心跳 | uint16 (0x0001) |
| 0x01 | 点亮对应灯 | uint16 (灯 ID 1-255) |
| 0x02 | 熄灭对应灯 | uint16 (灯 ID 1-255) |
| 0x03 | 控制所有灯 | uint16 (0xFFFF=亮,0x0000=灭) |

### 响应帧

响应命令字 = 发送命令字 + 0x80

| 发送 | 响应 |
|---|---|
| 0x00 | 0x80 |
| 0x01 | 0x81 |
| 0x02 | 0x82 |
| 0x03 | 0x83 |

### UART 波特率

| 波特率 | 适用 |
|---|---|
| 9600 | 出厂默认(CH9140) |
| 115200 | 高速(用户手动 AT+BAUD8) |

App 会在连接 BLE 后按 9600 → 115200 顺序探测,首个心跳通过的即锁定。

完整协议见 [PROTOCOL.md](StableDeviceApp/PROTOCOL.md)。

## 项目结构

```
Bluetooth-device/
├── StableDeviceApp/              ← 主项目 (React Native + Expo)
│   ├── src/
│   │   ├── components/           # UI 组件 (SwipeableRow, ErrorBoundary, ImageUploadField)
│   │   ├── context/              # React Context (UserContext)
│   │   ├── navigation/           # 导航 (AppNavigator)
│   │   ├── screens/              # 10 个页面
│   │   │   ├── DeviceListScreen.js     # 库存主屏
│   │   │   ├── DeviceDetailScreen.js   # 器件详情
│   │   │   ├── AdminEditScreen.js      # 器件编辑
│   │   │   ├── NewDeviceScreen.js      # 新建器件
│   │   │   ├── BOMScreen.js            # BOM 配单
│   │   │   ├── ScanScreen.js           # 扫码导入
│   │   │   ├── ProfileScreen.js        # 个人中心
│   │   │   ├── ConnectionScreen.js     # 蓝牙连接
│   │   │   ├── ShelfManagerScreen.js   # 库存管理
│   │   │   └── CategoryManagementScreen.js
│   │   ├── services/             # 服务层
│   │   │   ├── CommandBuilder.js       # 命令帧
│   │   │   ├── BluetoothHandler.js     # 蓝牙(含 fastControlAll)
│   │   │   ├── StorageService.js       # 数据存储
│   │   │   ├── ShelfService.js         # 库存 CRUD + 事件订阅
│   │   │   └── DeviceCategoryService.js
│   │   └── utils/                # 工具函数
│   │       ├── ErrorHandler.js
│   │       ├── SearchUtils.js
│   │       ├── StorageUtils.js
│   │       ├── positionUtils.js
│   │       ├── autoConnectBluetooth.js
│   │       ├── lightStatusStore.js     # 集中式亮灯状态
│   │       ├── lightEvents.js          # 亮灯事件总线
│   │       ├── pendingAutoConnect.js
│   │       └── pendingBomImport.js
│   ├── android/                  # Android 原生工程
│   ├── assets/                   # 资源文件
│   ├── API.md                    # 完整 API 文档 (v1.2.3)
│   ├── PROTOCOL.md               # 通信协议详细文档
│   ├── README.md                 # 完整项目说明
│   ├── package.json
│   └── app.json
├── crawler_server.py             # 辅助工具(独立爬虫,与 App 无关)
└── README.md                     # 本文件
```

## 常见问题

### Q1: 蓝牙扫描不到设备?
本 App **只扫描 `W02_` 开头的蓝牙模块**,其他设备被过滤。如果你的模块名称不符,需要在厂商工具里改名,或者在源码里改 `BluetoothHandler.js:218` 的 `startsWith('W02_')` 条件。

### Q2: 蓝牙连接失败?
1. 蓝牙已开启
2. 模块在范围内
3. 模块 UART 波特率 = 9600 或 115200
4. 重启 App 后重试

### Q3: 切库后旧库存灯没灭?
旧问题已修复(v1.2.2):走 `fastControlAll` 1.5s 超时不等 ACK,即使 BLE 链路被 OS 挂起也能快速灭灯。

### Q4: 灯不亮?
1. 检查库存页右上角徽章(已连接/未连接)
2. 设置 → 库存管理查看蓝牙绑定
3. 器件位置是否正确
4. 重新发送指令

### Q5: 数据丢失?
用"数据导入"恢复(应用内或外部 App 打开)。**建议定期导出备份**。

### Q6: 微信分享的 JSON 打开后提示"库存不存在"?
JSON 文件名即库存名。文件名为空 / 含特殊字符 / 损坏都会拒绝。重命名后重试。

### Q7: BOM 失焦后回到库存页灯残留?
已修复(v1.2.2):BOM 失焦时走 `turnOffAllLights` 一次灭所有 + 集中式 store 同步。

### Q8: vivo 手机 BOM 页 UI 偶发消失?
已修复(v1.2.2):`turnOffAllLights` 改 fire-and-forget + store listener 加 `isMountedRef`。

### Q9: 为什么不再弹"上次运行出现错误"了?
v1.2.3 起移除:那个拦截器把 ble-plx 正常断连/性能噪音当成崩溃记录,误报严重。删除后只 console.error 不弹窗。

## 更新日志

### v1.2.3 (2026-07-07)
**功能**
- 蓝牙扫描过滤 `W02_` 前缀设备,只显示本 app 专用蓝牙模块

**版本号同步**
- `package.json` / `app.json` / `android/app/build.gradle` 三处版本号从 1.0.3 升到 1.2.3
- `versionCode` 1 → 2

**优化**
- 移除"上次运行出现错误"弹窗(拦截器误报,删除更清爽)

### v1.2.2 (2026-07-07)
**新增强化**
- `lightStatusStore` + `lightEvents` 集中式亮灯状态(跨页面唯一权威源)
- `BluetoothHandler.fastControlAll()` 1.5s 超时不等 ACK(BLE 链路死时不被卡)
- `ShelfService.setCurrentShelfId` 切库时优先 fastControlAll 灭灯
- `ShelfService.clearBomAndLights()` 公开函数(导入前清灯)
- BOM 失焦完整清理(走 store + 物理灭灯)

**问题修复**
- BOM 切回库存页绿底残留
- 切库时旧库存物理灯不灭
- 微信导入库存时旧库存灯不灭
- "上次运行出现错误"反复弹出
- BOM 失焦时只灭最后点亮的灯
- 清空 BOM 后绿底偶发残留
- 切到同名库存时二次切库灭灯遗漏
- **vivo 手机 BOM 页面 UI 偶发消失**

**内部优化**
- BOMScreen 提取 `turnOffAllLights()` 工具
- `importShelfFromFile` 改走 `setCurrentShelfId`
- `setCurrentShelfId` 内部并发处理 controlAll + emit + cache

### v1.2.1 (2026-07-03)
**行为变更**
- 零库存时 4 个 tab 全部常驻可点
- "连接"/"BOM匹配"页零库存时顶部 ⚠️ 黄色提示条
- 点击"扫描蓝牙设备"/"导入 BOM" 弹"当前无库存"

**问题修复**
- `ShelfService.subscribeShelves` undefined 崩溃
- `tabBarStyle: { display: 'none' }` 误隐藏 tab bar

### v1.2.0 (2026-07-03)
**新增**
- 多库存管理
- 新装零库存
- 外部 App 导入(微信/QQ/邮件)
- 按文件名匹配库存
- 导入后自动切库 + 自动重连
- "蓝牙不在范围"提示
- 库存管理页(新建/重命名/删除/绑定徽章)

**优化**
- 导入弹窗文案(新增/覆盖一句话结果)
- 切库时清理全局连接状态
- 波特率错误提示文案

**修复**
- 切库时连接页 stale "已连接"
- 切到无绑定库存时偷连 last device
- 手选蓝牙后自动绑定导致错误关联
- 切库后跳到连接页崩溃
- 零库存时仍可进入"BOM匹配"
- 导入同名库存时取错源数据
- 导入文件名为非法字符时崩溃

### v1.0.2 (2026-05-28)
**变更**
- 取消登录注册(自动管理员登录)
- 删除电气参数(电阻/电压/电容/电感/电流/功率/频率)
- 类别/封装/位置/备注合并到基本信息
- 数据备份改为数据导出(支持自定义保存位置/默认命名/重命名)
- 数据恢复改为数据导入
- 扫码导入弹窗按钮调整(确认在左,取消在右)
- 扫码逻辑优化(默认上架第一个空位置)

**移除**
- 登录注册页面
- 修改密码功能
- 退出登录功能
- 串口模拟功能

### v1.0.0 (2026-05-13)
**修复**
- Base64 编码填充错误
- 库存不足器件也被点亮
- 普通用户显示管理员权限
- useEffect 依赖导致的定时器问题
- 搜索建议可能导致的无限循环
- BOM 配单中库存不足器件也能取出

**优化**
- 蓝牙连接稳定性
- 用户权限验证逻辑
- 搜索建议生成性能

---

## 许可证

MIT License
