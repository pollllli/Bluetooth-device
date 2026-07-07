# 器件管理系统 - API 文档

> **版本**：v1.2.2 (2026-07-07)
> **项目路径**：`StableDeviceApp/`
> **技术栈**：React Native + Expo + react-native-ble-plx

本文档基于最新代码梳理，描述所有服务层和工具层的公开 API。若代码与本文档冲突，**以代码为准**。

---

## 目录

- [架构总览](#架构总览)
- [服务层](#服务层)
  - [CommandBuilder](#1-commandbuilder命令帧构建器)
  - [BluetoothHandler](#2-bluetoothhandler蓝牙通信)
  - [StorageService](#3-storageservice数据存储)
  - [ShelfService](#4-shelfservice库存管理)
  - [DeviceCategoryService](#5-devicecategoryservice分类服务)
- [状态层](#状态层)
  - [lightStatusStore](#6-lightstatusstore亮灯状态中心)
  - [lightEvents](#7-lightevents跨页面事件总线)
- [工具层](#工具层)
  - [positionUtils](#8-positionutils位置工具)
  - [SearchUtils](#9-searchutils搜索工具)
  - [StorageUtils](#10-storageutils存储工具)
  - [autoConnectBluetooth](#11-autoconnectbluetooth后台自动重连)
  - [pendingBomImport](#12-pendingbomimport跨页面bom传递)
  - [pendingImportAction](#13-pendingimportaction跨页面导入动作)
  - [pendingAutoConnect](#14-pendingautoconnect跨页面自动重连)
  - [ErrorHandler](#15-errorhandler错误拦截)
- [React 上下文](#react-上下文)
  - [UserContext](#usermanagercontext)
- [应用入口](#应用入口)
  - [App.tsx](#apptsx)
- [协议参考](#协议参考)

---

## 架构总览

```
┌────────────────────────────────────────────────────────────┐
│  Screens (UI 层)                                            │
│  DeviceList / BOM / NewDevice / Connection / Profile / ... │
└────────────┬───────────────────────────┬───────────────────┘
             │                           │
     业务状态 (useReducer)         亮灯状态 (lightStatusStore)
             │                           │
┌────────────▼───────────────────────────▼───────────────────┐
│  Services (业务层)                                          │
│  ShelfService → setCurrentShelfId 同步触发:                │
│    1) controlAll: false (物理灭灯)                          │
│    2) emitLightAllOff (UI 同步)                             │
│    3) notifyCurrentShelfChanged (BOM 清空)                  │
│                                                            │
│  StorageService → importShelfFromFile 同步触发:            │
│    1) ShelfService.clearBomAndLights (前)                  │
│    2) ShelfService.setCurrentShelfId (切库)                │
└────────────┬───────────────────────────────────────────────┘
             │
┌────────────▼───────────────────────────────────────────────┐
│  BluetoothHandler (通信层)                                  │
│  sendCommand (等 ACK) / fastControlAll (不等 ACK + 1.5s)    │
└────────────────────────────────────────────────────────────┘
```

**关键设计原则**：

1. **切库/导入的副作用统一走 `ShelfService.setCurrentShelfId`**：所有需要"切库"的代码都走这一条路径，保证"灭灯+清 BOM+UI 同步"不遗漏。
2. **`fastControlAll` 用于切库/断连等"必须发出去"的场景**：`sendCommand` 内部用 `writeCharacteristicWithResponseForDevice`（等 ACK），如果 BLE 链路被 Android 挂起，写入会卡死到超时；`fastControlAll` 用 `writeCharacteristicWithoutResponseForDevice` + 1.5 秒硬超时。
3. **`lightStatusStore` 是亮灯状态的唯一真相源**：所有页面（DeviceList / BOM）通过 `subscribeLightStatus` 同步，不依赖 React 生命周期。

---

## 服务层

### 1. CommandBuilder（命令帧构建器）

**路径**：`src/services/CommandBuilder.js`
**作用**：构建符合 [PROTOCOL.md](./PROTOCOL.md) 的 7 字节命令帧。

#### 1.1 `calculateCRC8(data)`

计算 CRC-8/MAXIM 校验值。

| 参数 | 类型 | 说明 |
|---|---|---|
| data | `Array<number>` | 要校验的数据 |

**返回**：`number` (0-255)

#### 1.2 `buildCommandFrame(cmd, data)`

构建完整命令帧 `[0x55, 0xAA, cmd, len, data_hi, data_lo, crc]`。

| 参数 | 类型 | 说明 |
|---|---|---|
| cmd | `number` | 命令字 0x00~0x03 |
| data | `Array<number>` | 数据（uint16 数组） |

**返回**：`Array<number>` (7 字节)

#### 1.3 便捷方法

| 方法 | 等价于 |
|---|---|
| `buildLightOnCommand(lightId)` | `buildCommandFrame(0x01, [lightId])` |
| `buildLightOffCommand(lightId)` | `buildCommandFrame(0x02, [lightId])` |
| `buildControlAllLightsCommand(state)` | `buildCommandFrame(0x03, [state ? 0xFFFF : 0])` |
| `buildHeartbeatCommand()` | `buildCommandFrame(0x00, [1])` |

#### 1.4 `parseResponseFrame(data)`

解析 MCU 响应帧。返回 `{ cmd, responseCmd, data, dataCount, success, timestamp }`。

---

### 2. BluetoothHandler（蓝牙通信）

**路径**：`src/services/BluetoothHandler.js`
**单例**：通过 `global.deviceConnection.handler` 访问已连接的 handler。

#### 2.1 生命周期

| 方法 | 说明 |
|---|---|
| `initialize()` | 初始化 BLE manager |
| `scanForDevices(timeoutMs=8000)` | 扫描周边 BLE 设备，返回 `[{id, name, rssi}]` |
| `connectToDevice(deviceId)` | 连接指定 deviceId，返回 `{success, device, error}` |
| `disconnect()` | **断连 + 灭所有灯**（详见下） |
| `isConnected()` | 检查当前连接状态 |

#### 2.2 `sendCommand(command)` ⭐

**通用发送**。内部用 `writeCharacteristicWithResponseForDevice`（等 ACK），**链路挂起时会卡到超时**。

| 参数 | 类型 | 说明 |
|---|---|---|
| command.type | `string` | `'lightOn'` / `'lightOff'` / `'controlAll'` / `'heartbeat'` / `'lightQuery'` |
| command.id | `number` | 灯 ID 1-255（`lightOn`/`lightOff`） |
| command.state | `boolean` | `true`=亮 / `false`=灭（`controlAll`） |

**返回**：`{success: boolean, message?: string}`

#### 2.3 `fastControlAll(state)` ⭐ 新增

**快速控制所有灯**。不等 ACK + 1.5 秒硬超时，专为"切库/断连"等"必须发出去"的场景设计。

| 参数 | 类型 | 说明 |
|---|---|---|
| state | `boolean` | `true`=全亮 / `false`=全灭 |

**返回**：`Promise<{success: boolean, timeout?: boolean}>`

**实现**：

```js
async fastControlAll(state) {
  // 1) writeCharacteristicWithoutResponseForDevice (fire-and-forget)
  // 2) Promise.race([write, setTimeout(reject, 1500)])
}
```

#### 2.4 `sendHeartbeat()`

发送心跳（0x00 + 0x0001），用于检测链路活性。

#### 2.5 `autoDetectBaudRate()`

**多波特率自适应**。按 `9600 → 115200` 顺序发送 `AT+BAUD` + 心跳验证，第一个心跳通过的即锁定。

| 波特率 | 适用 | AT 指令 |
|---|---|---|
| 9600 | CH9140 出厂默认 | `AT+BAUD4` |
| 115200 | 高速 | `AT+BAUD8` |

#### 2.6 内部方法（一般不直接调）

| 方法 | 说明 |
|---|---|
| `discoverServicesAndCharacteristics(device)` | 发现 GATT service/characteristic |
| `subscribeToCharacteristic()` | 订阅 notify characteristic（接收 MCU 响应） |
| `sendTestCommand(data, isHex)` | 调试用：发任意字节 |
| `setBaudRate(baudRate)` | 设置 UART 波特率 |

#### 2.7 `disconnect()` ⭐ 修改过

断连前**先发 `fastControlAll(false)`** 灭所有灯。失败兜底用 `sendCommand`。

```js
async disconnect() {
  // 1) fastControlAll(false) - 1.5s 超时
  // 2) sendCommand({type: 'controlAll', state: false}) - 兜底
  // 3) cancelDeviceConnection
  // 4) destroy
  // 5) global.deviceConnection = null
}
```

---

### 3. StorageService（数据存储）

**路径**：`src/services/StorageService.js`
**底层**：AsyncStorage（key 前缀 `@deviceManager:`）

#### 3.1 器件 CRUD

| 方法 | 签名 | 说明 |
|---|---|---|
| `getDevices()` | `() => Promise<Device[]>` | 拉所有器件 |
| `addDevice(device)` | `(d) => Promise<Device>` | 新增（含图片持久化） |
| `updateDevice(device)` | `(d) => Promise<Device>` | 更新 |
| `deleteDevice(id)` | `(id) => Promise<boolean>` | 删除 |
| `getDeviceById(id)` | `(id) => Promise<Device?>` | 单查 |

`Device` 字段：`{id, name, code, package, category, position, count, shelfId, image, ...}`

#### 3.2 器件图片管理

| 方法 | 说明 |
|---|---|
| `persistImageToSandbox(uri)` | 把临时图片 URI 复制到沙盒，返回永久路径 |

**注**：复制失败时返回原 URI，**不抛错**。后续 `getDevices` 会扫描 `IMAGES_DIR`，丢失的图片清成空串。

#### 3.3 库存数据

| 方法 | 签名 | 说明 |
|---|---|---|
| `getShelves()` | `() => Promise<Shelf[]>` | 拉所有库存 |
| `saveShelf(shelf)` | `(s) => Promise<Shelf>` | 存/更 |
| `deleteShelf(id)` | `(id) => Promise<boolean>` | 删（连同器件） |
| `getShelf(id)` | `(id) => Promise<Shelf?>` | 单查 |
| `getCurrentShelfId()` | `() => Promise<string?>` | 读当前库存 id |
| `setCurrentShelfId(id)` | `(id) => Promise<boolean>` | **写当前库存 id** |

> **重要**：`setCurrentShelfId` 是 StorageService 层的，**只写盘不触发副作用**。所有需要"切库副作用"的代码应该用 [`ShelfService.setCurrentShelfId`](#44-setshelfservice-changes-currentshelfid)。

#### 3.4 数据导入导出 ⭐ 修改过

| 方法 | 签名 | 说明 |
|---|---|---|
| `exportShelves(shelfIds)` | `(ids) => Promise<{uri, name}>` | 导出选中库存为 JSON |
| `importShelfFromFile(uri, fileName)` | `(uri, name) => Promise<{status, targetShelfId}>` | 单库存导入（按文件名匹配） |
| `importAllData(jsonString)` | `(s) => Promise<{restored}>` | 全库导入 |

**`importShelfFromFile` 流程**（v1.2.2 改）：

```
1. parseFile(uri) → {name, data}
2. 按 fileName 匹配目标库存:
   - 本地有同名 → 覆盖 (保留 id + 蓝牙绑定)
   - 本地无同名 → 新建
3. ShelfService.setCurrentShelfId(targetShelfId)
   → 自动触发: 灭灯 + UI 同步 + 通知 BOM
```

**返回值**：
- `status: 'created'` 新建
- `status: 'overwritten'` 覆盖

#### 3.5 应用恢复

| 方法 | 说明 |
|---|---|
| `getLastError()` / `setLastError(err)` / `clearLastError()` | 上次崩溃错误捕获（App.tsx 启动时检查并弹窗） |

---

### 4. ShelfService（库存管理）

**路径**：`src/services/ShelfService.js`

> **核心**：切库/导入相关的副作用**统一收口在 `setCurrentShelfId`**，其他模块不要再单独发灭灯指令。

#### 4.1 CRUD

| 方法 | 签名 | 说明 |
|---|---|---|
| `getShelves()` | `() => Promise<Shelf[]>` | 拉所有库存（带缓存） |
| `addShelf(name)` | `(n) => Promise<Shelf>` | 新建库存 |
| `renameShelf(id, newName)` | `(id, n) => Promise<Shelf>` | 重命名 |
| `deleteShelf(id)` | `(id) => Promise<boolean>` | 删除（含器件） |
| `getCurrentShelf()` | `() => Promise<Shelf?>` | 当前库存对象 |
| `getShelfDeviceCount(id)` | `(id) => Promise<number>` | 库存内器件数 |

#### 4.2 切库 ⭐ 修改过

##### `setCurrentShelfId(id)` — 切库的统一入口

**v1.2.2 关键修复**：之前是"只写盘不灭灯"，现在切库会**自动触发物理灭灯 + UI 同步 + BOM 清空**。

```js
async setCurrentShelfId(id) {
  const prev = await this.getCurrentShelfId();
  if (prev === id) return; // 幂等
  await storage.setCurrentShelfId(id);
  
  // 【副作用1】物理灭所有灯 (走 fastControlAll, 不阻塞切库)
  if (global.deviceConnection?.handler) {
    try {
      const h = global.deviceConnection.handler;
      if (typeof h.fastControlAll === 'function') {
        await h.fastControlAll(false);
      } else {
        await h.sendCommand({type: 'controlAll', state: false});
      }
    } catch (e) { /* 蓝牙断不阻塞切库 */ }
  }
  
  // 【副作用2】UI 同步
  clearAllLitDevices();  // lightStatusStore
  emitLightAllOff();     // lightEvents (兼容老 listener)
  
  // 【副作用3】通知 BOMScreen 清空
  notifyCurrentShelfChanged(id);
}
```

##### `clearBomAndLights()` — 导入前的"清空+灭灯"

**v1.2.2 新增**。在用户**点击导入按钮**或**外部 intent 触发导入**时调用，**比弹窗出现更早**，防止"用户看到了旧库存的灯还亮着"。

```js
async clearBomAndLights() {
  if (global.deviceConnection?.handler) {
    try {
      const h = global.deviceConnection.handler;
      if (typeof h.fastControlAll === 'function') {
        await h.fastControlAll(false);
      }
    } catch (e) {}
  }
  clearAllLitDevices();
  emitLightAllOff();
  notifyCurrentShelfChanged(await this.getCurrentShelfId());
}
```

#### 4.3 蓝牙绑定

| 方法 | 签名 | 说明 |
|---|---|---|
| `setShelfBluetooth(shelfId, mac, name)` | 绑定 MAC |
| `getShelfBluetooth(shelfId)` | `(id) => Promise<{mac, name}?>` |

#### 4.4 事件订阅

| 方法 | 说明 |
|---|---|
| `subscribeShelves(cb)` | 库存列表变化 (创建/重命名/删除) |
| `subscribeCurrentShelf(cb)` | 当前库存 id 变化 (切库触发) |

```js
// BOMScreen 订阅切库
const unsubscribe = ShelfService.subscribeCurrentShelf((newShelfId) => {
  setComponents([]);
  setLitDeviceIds([]);
});
return unsubscribe;
```

---

### 5. DeviceCategoryService（分类服务）

**路径**：`src/services/DeviceCategoryService.js`

| 方法 | 签名 | 说明 |
|---|---|---|
| `getAll()` | `() => Promise<Category[]>` | 全部分类 |
| `add(name)` | `(n) => Promise<Category>` | 新增 |
| `update(id, name)` | `(id, n) => Promise<Category>` | 改 |
| `delete(id)` | `(id) => Promise<boolean>` | 删 |

---

## 状态层

### 6. lightStatusStore（亮灯状态中心）⭐ 新增

**路径**：`src/utils/lightStatusStore.js`

> **v1.2.2 新增**。之前"点亮所有/熄灭所有"和"单灯操作"两套状态机不对称，导致"熄灭所有"后 UI 残留 ids。本模块提供**集中式状态机**，所有页面订阅同一份状态。

#### 6.1 状态模型

```
_internalSet: Set<deviceId>  // 内部存储
_listeners: Set<cb>          // 订阅者
```

事件类型（推送给订阅者）：
- `{type: 'add', deviceId, ids}` — 单个加
- `{type: 'remove', deviceId, ids}` — 单个减
- `{type: 'set', ids}` — 批量设
- `{type: 'allOff', ids: []}` — 全清

#### 6.2 API

```js
import {
  subscribeLightStatus,    // (cb) => unsubscribe
  getLitDeviceIdsSnapshot, // () => string[]  (注意: 返回数组的引用是新数组, 但只读)
  addLitDevice,            // (id) => void
  removeLitDevice,         // (id) => void
  setLitDevices,           // (ids[]) => void
  clearAllLitDevices,      // () => void
} from '../utils/lightStatusStore';
```

#### 6.3 用法示例

```js
// 订阅
useEffect(() => {
  const unsub = subscribeLightStatus((event) => {
    setLitDeviceIds(getLitDeviceIdsSnapshot());
  });
  return unsub;
}, []);

// 单灯操作
addLitDevice(device.id);
removeLitDevice(device.id);

// 全亮 (DeviceList "点亮所有")
setLitDevices(allDeviceIds);

// 全灭 (DeviceList "熄灭所有" / 切库副作用)
clearAllLitDevices();
```

#### 6.4 设计要点

- **跨页面同步**：DeviceList 点亮 → BOMScreen 立即看到
- **跨页面操作**：BOM 失焦调 `clearAllLitDevices()` → DeviceList 立即全白
- **避免 setState on unmount**：listener 不直接 setState，调用方自己 setState

---

### 7. lightEvents（跨页面事件总线）⭐ 新增

**路径**：`src/utils/lightEvents.js`

> **v1.2.2 新增**。比 `lightStatusStore` 更"事件式"，不存状态只发事件。

```js
import { subscribe, emitLightAllOff } from '../utils/lightEvents';

// 订阅 (无 prev 参数区分)
const unsub = subscribe((event) => {
  if (event.type === 'allOff') { ... }
});

// 触发
emitLightAllOff();
```

事件类型：
- `{type: 'allOff'}` — 所有灯已灭（兼容老 listener）

---

## 工具层

### 8. positionUtils（位置工具）

**路径**：`src/utils/positionUtils.js`

| 方法 | 签名 | 说明 |
|---|---|---|
| `findFirstEmptyPosition(devices, shelfId)` | `(d, s) => number` | 找第一个空位 (0-239) |
| `getOccupiedPositionMap(devices, shelfId)` | `(d, s) => Map<pos, name>` | 已占用位置 map |

**注意**：这两个都是**同步函数**，不要声明为 `async`。render 阶段直接用。

---

### 9. SearchUtils（搜索工具）

**路径**：`src/utils/SearchUtils.js`

| 方法 | 签名 |
|---|---|
| `normalize(str)` | `(s) => string`  (大小写/全半角/繁简) |
| `searchDevices(devices, query, fields)` | `(d, q, f) => Device[]` |
| `fuzzyMatch(str, pattern)` | `(s, p) => boolean` |

---

### 10. StorageUtils（存储工具）

**路径**：`src/utils/StorageUtils.js`

| 方法 | 签名 | 说明 |
|---|---|---|
| `saveData(key, value)` | `(k, v) => Promise` | 写入 |
| `loadData(key, defaultValue)` | `(k, d?) => Promise<any>` | 读取 |
| `removeData(key)` | `(k) => Promise` | 删除 |
| `getAllKeys()` | `() => Promise<string[]>` | 所有 key |

**注意**：`saveData(key, undefined)` **不抛错**，但 AsyncStorage 内部会警告。**应该用 `removeData` 清值**。

---

### 11. autoConnectBluetooth（后台自动重连）

**路径**：`src/utils/autoConnectBluetooth.js`

```js
import { autoConnectBluetooth } from '../utils/autoConnectBluetooth';

// 切库或导入后, 后台尝试连接该库存绑定的蓝牙
await autoConnectBluetooth(shelfId, onProgress);
```

`onProgress` 回调：
- `onProgress('scanning', {device})` — 扫到设备
- `onProgress('connected', {device})` — 连上
- `onProgress('timeout', {})` — 5 秒内未扫到
- `onProgress('failed', {error})` — 失败

---

### 12. pendingBomImport（跨页面 BOM 传递）⭐ 新增

**路径**：`src/utils/pendingBomImport.js`

> **v1.2.2 新增**。外部 intent（微信/邮件）触发的 BOM 导入，需要跨过"App 启动 → BOMScreen mount"的间隙。

```js
import {
  setPendingBomImport,    // ({uri, name}) => void
  consumePendingBomImport, // () => {uri, name} | null
  usePendingBomImport,    // React hook
} from '../utils/pendingBomImport';
```

**注意**：模块级单例，**重入会覆盖**。用户连续分享两个 BOM，第二个会覆盖第一个（**待优化**）。

---

### 13. pendingImportAction（跨页面导入动作）⭐ 新增

**路径**：`src/utils/pendingImportAction.js`

> **v1.2.2 新增**。专门为"导入新库存数据"设计的事件总线。**弹窗出现时即触发**，与 BOM 导入区分（用 prev 参数区分冷启动 vs 用户主动）。

```js
import { setAction, subscribe, getAction, clearAction } from '../utils/pendingImportAction';

setAction('importData', { fileName, data });

const unsub = subscribe((action, prev) => {
  if (!prev) return; // 冷启动残留, 跳过
  // 用户主动点导入 → 立即清 BOM + 灭灯
  clearBOMAndLights();
});
```

---

### 14. pendingAutoConnect（跨页面自动重连）

**路径**：`src/utils/pendingAutoConnect.js`

切库/导入时，需要把"待重连的 MAC"传到 ConnectionScreen：

```js
setPendingAutoConnect(mac);  // DeviceList 切库后调
const mac = consumePendingAutoConnect();  // ConnectionScreen mount 时消费
```

---

### 15. ErrorHandler（错误拦截）

**路径**：`src/utils/ErrorHandler.js`

| 方法 | 签名 | 说明 |
|---|---|---|
| `logError(message, error, context)` | `(m, e, c) => void` | 记录到 AsyncStorage `@lastError` |
| `showError(message, error)` | toast 弹错 |

`App.tsx` 启动时检查 `@lastError`，有则弹"上次运行出现错误" Modal。

---

## React 上下文

### UserManagerContext

**路径**：`src/context/UserContext.js`

```js
const { user, isAdmin } = useUser();
```

本应用固定以**管理员**身份登录（`isAdmin = true`），无登录注册。

---

## 应用入口

### App.tsx

启动流程：

```
1. registerRootComponent
2. ErrorBoundary 包裹
3. useEffect 启动:
   a. logError 拦截器 (console.error → AsyncStorage @lastError)
   b. 检查 @lastError → 弹 modal
4. UserManagerProvider
5. AppNavigator (含 ShelfService.subscribeShelves)
6. AppState 监听 (active/background)
7. 外部 intent (微信/邮件) 处理:
   - .json → confirmImport dialog → ShelfService.clearBomAndLights + importShelfFromFile
   - .xlsx/.csv (BOM) → pendingBomImport.setPendingBomImport → 跳 BOMScreen
```

---

## 协议参考

完整协议见 [PROTOCOL.md](./PROTOCOL.md)。

### 命令字速查

| 命令字 | 功能 | 数据 | 响应 |
|---|---|---|---|
| 0x00 | 心跳 | uint16(0x0001) | 0x80 |
| 0x01 | 点亮单灯 | uint16(1-255) | 0x81 |
| 0x02 | 熄灭单灯 | uint16(1-255) | 0x82 |
| 0x03 | 控制所有灯 | uint16(0xFFFF=亮, 0=灭) | 0x83 |

### 帧格式

```
[55] [AA] [CMD] [LEN] [DATA_H] [DATA_L] [CRC]
  ↑    ↑    ↑     ↑      ↑       ↑       ↑
帧头  帧头 命令字 数据长度 数据高字节 数据低字节 CRC-8/MAXIM
```

---

## 更新历史

### v1.2.2 (2026-07-07)

- **新增** `lightStatusStore` 集中式亮灯状态
- **新增** `lightEvents` 跨页面事件总线
- **新增** `pendingBomImport` / `pendingImportAction` 跨页面动作传递
- **新增** `BluetoothHandler.fastControlAll` 不等 ACK 快速发送
- **修改** `ShelfService.setCurrentShelfId` 切库自动触发物理灭灯 + UI 同步
- **修改** `StorageService.importShelfFromFile` 走 `ShelfService.setCurrentShelfId` 统一入口
- **修改** `BluetoothHandler.disconnect` 优先用 `fastControlAll`
- **删除** 旧文档中的 `SerialPortHelper` 章节（项目早就不用 USB 串口了）
