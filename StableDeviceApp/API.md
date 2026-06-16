# 器件管理系统 - API 文档

## 概述

本文档描述了器件管理系统的核心服务 API，包括命令帧构建、蓝牙通信、串口通信和数据存储等服务。

---

## 1. CommandBuilder（命令帧构建器）

### 1.1 类定义

```javascript
class CommandBuilder {
  constructor();
}
```

### 1.2 方法列表

#### 1.2.1 calculateCRC8

**功能**：计算 CRC-8/MAXIM 校验值

**参数**：

| 参数名 | 类型          | 说明                 |
| ------ | ------------- | -------------------- |
| data   | Array<number> | 要计算校验的数据数组 |

**返回值**：

| 类型   | 说明                       |
| ------ | -------------------------- |
| number | CRC-8/MAXIM 校验值 (0-255) |

**示例**：

```javascript
const builder = new CommandBuilder();
const data = [0x55, 0xaa, 0x01, 0x02, 0x00, 0x01];
const crc = builder.calculateCRC8(data);
// crc = 0xD5
```

---

#### 1.2.2 buildCommandFrame

**功能**：构建完整的命令帧

**参数**：

| 参数名 | 类型          | 说明                            |
| ------ | ------------- | ------------------------------- |
| cmd    | number        | 命令字 (0-255)                  |
| data   | Array<number> | 数据数组（每个元素为 uint16_t） |

**返回值**：

| 类型          | 说明              |
| ------------- | ----------------- |
| Array<number> | 完整的7字节命令帧 |

**示例**：

```javascript
const builder = new CommandBuilder();
const frame = builder.buildCommandFrame(0x01, [1]);
// frame = [0x55, 0xAA, 0x01, 0x02, 0x00, 0x01, 0xD5]
```

---

#### 1.2.3 buildLightOnCommand

**功能**：构建点亮灯命令帧

**参数**：

| 参数名  | 类型   | 说明         |
| ------- | ------ | ------------ |
| lightId | number | 灯ID (1-255) |

**返回值**：

| 类型          | 说明         |
| ------------- | ------------ |
| Array<number> | 点亮灯命令帧 |

**示例**：

```javascript
const builder = new CommandBuilder();
const frame = builder.buildLightOnCommand(5);
// 点亮位置5的灯
```

---

#### 1.2.4 buildLightOffCommand

**功能**：构建熄灭灯命令帧

**参数**：

| 参数名  | 类型   | 说明         |
| ------- | ------ | ------------ |
| lightId | number | 灯ID (1-255) |

**返回值**：

| 类型          | 说明         |
| ------------- | ------------ |
| Array<number> | 熄灭灯命令帧 |

**示例**：

```javascript
const builder = new CommandBuilder();
const frame = builder.buildLightOffCommand(5);
// 熄灭位置5的灯
```

---

#### 1.2.5 buildControlAllLightsCommand

**功能**：构建控制所有灯命令帧

**参数**：

| 参数名 | 类型    | 说明                              |
| ------ | ------- | --------------------------------- |
| state  | boolean | true=点亮所有灯, false=熄灭所有灯 |

**返回值**：

| 类型          | 说明             |
| ------------- | ---------------- |
| Array<number> | 控制所有灯命令帧 |

**示例**：

```javascript
const builder = new CommandBuilder();
const frame1 = builder.buildControlAllLightsCommand(true); // 点亮所有
const frame2 = builder.buildControlAllLightsCommand(false); // 熄灭所有
```

---

#### 1.2.6 buildHeartbeatCommand

**功能**：构建心跳命令帧

**参数**：无

**返回值**：

| 类型          | 说明       |
| ------------- | ---------- |
| Array<number> | 心跳命令帧 |

**示例**：

```javascript
const builder = new CommandBuilder();
const frame = builder.buildHeartbeatCommand();
// frame = [0x55, 0xAA, 0x00, 0x02, 0x00, 0x01, 0xD5]
```

---

#### 1.2.7 parseResponseFrame

**功能**：解析MCU响应帧

**参数**：

| 参数名 | 类型          | 说明       |
| ------ | ------------- | ---------- |
| data   | Array<number> | 响应帧数据 |

**返回值**：

| 类型   | 说明             |
| ------ | ---------------- |
| Object | 解析后的响应对象 |

**返回对象结构**：

| 字段        | 类型          | 说明                   |
| ----------- | ------------- | ---------------------- |
| cmd         | number        | 原始命令字 (0-3)       |
| responseCmd | number        | 响应命令字 (0x80-0x83) |
| data        | Array<number> | 响应数据               |
| dataCount   | number        | 数据个数               |
| success     | boolean       | 是否成功               |
| timestamp   | string        | 时间戳                 |

**示例**：

```javascript
const builder = new CommandBuilder();
const response = builder.parseResponseFrame([
  0x55, 0xaa, 0x81, 0x02, 0x00, 0x01, 0xfc,
]);
// response = { cmd: 1, responseCmd: 0x81, data: [1], dataCount: 1, success: true, timestamp: "..." }
```

---

#### 1.2.8 frameToHex

**功能**：将命令帧转换为十六进制字符串

**参数**：

| 参数名 | 类型          | 说明   |
| ------ | ------------- | ------ |
| frame  | Array<number> | 命令帧 |

**返回值**：

| 类型   | 说明           |
| ------ | -------------- |
| string | 十六进制字符串 |

**示例**：

```javascript
const builder = new CommandBuilder();
const frame = [0x55, 0xaa, 0x01, 0x02, 0x00, 0x01, 0xd5];
const hex = builder.frameToHex(frame);
// hex = "55 aa 01 02 00 01 d5"
```

---

#### 1.2.9 hexToFrame

**功能**：将十六进制字符串转换为命令帧

**参数**：

| 参数名    | 类型   | 说明           |
| --------- | ------ | -------------- |
| hexString | string | 十六进制字符串 |

**返回值**：

| 类型          | 说明   |
| ------------- | ------ |
| Array<number> | 命令帧 |

**示例**：

```javascript
const builder = new CommandBuilder();
const frame = builder.hexToFrame('55 aa 01 02 00 01 d5');
// frame = [0x55, 0xAA, 0x01, 0x02, 0x00, 0x01, 0xD5]
```

---

#### 1.2.10 validateFrame

**功能**：验证命令帧的有效性

**参数**：

| 参数名 | 类型          | 说明   |
| ------ | ------------- | ------ |
| frame  | Array<number> | 命令帧 |

**返回值**：

| 类型    | 说明     |
| ------- | -------- |
| boolean | 是否有效 |

**示例**：

```javascript
const builder = new CommandBuilder();
const frame = [0x55, 0xaa, 0x01, 0x02, 0x00, 0x01, 0xd5];
const isValid = builder.validateFrame(frame);
// isValid = true
```

---

#### 1.2.11 getSupportedCommands

**功能**：获取支持的命令列表

**参数**：无

**返回值**：

| 类型   | 说明         |
| ------ | ------------ |
| Object | 命令列表对象 |

**返回对象结构**：

| 字段         | 类型   | 说明         |
| ------------ | ------ | ------------ |
| HEARTBEAT    | number | 0x00         |
| LIGHT_ON     | number | 0x01         |
| LIGHT_OFF    | number | 0x02         |
| CONTROL_ALL  | number | 0x03         |
| descriptions | Object | 命令描述对象 |

**示例**：

```javascript
const builder = new CommandBuilder();
const commands = builder.getSupportedCommands();
// commands = { HEARTBEAT: 0, LIGHT_ON: 1, LIGHT_OFF: 2, CONTROL_ALL: 3, descriptions: {...} }
```

---

## 2. BluetoothHandler（蓝牙通信处理器）

### 2.1 类定义

```javascript
class BluetoothHandler {
  constructor();
}
```

### 2.2 方法列表

#### 2.2.1 initialize

**功能**：初始化蓝牙管理器

**参数**：无

**返回值**：

| 类型          | 说明       |
| ------------- | ---------- |
| Promise<void> | 初始化结果 |

**示例**：

```javascript
const handler = new BluetoothHandler();
await handler.initialize();
```

---

#### 2.2.2 startScanning

**功能**：开始扫描蓝牙设备

**参数**：

| 参数名   | 类型     | 说明         |
| -------- | -------- | ------------ |
| callback | function | 扫描回调函数 |

**返回值**：无

**示例**：

```javascript
const handler = new BluetoothHandler();
handler.startScanning((devices) => {
  console.log('发现设备:', devices);
});
```

---

#### 2.2.3 stopScanning

**功能**：停止扫描蓝牙设备

**参数**：无

**返回值**：无

**示例**：

```javascript
const handler = new BluetoothHandler();
handler.stopScanning();
```

---

#### 2.2.4 connectToDevice

**功能**：连接到蓝牙设备

**参数**：

| 参数名   | 类型   | 说明   |
| -------- | ------ | ------ |
| deviceId | string | 设备ID |

**返回值**：

| 类型            | 说明     |
| --------------- | -------- |
| Promise<Object> | 连接结果 |

**示例**：

```javascript
const handler = new BluetoothHandler();
const result = await handler.connectToDevice('3C:AB:72:38:11:CF');
// result = { success: true, device: {...} }
```

---

#### 2.2.5 disconnect

**功能**：断开蓝牙连接

**参数**：无

**返回值**：

| 类型          | 说明     |
| ------------- | -------- |
| Promise<void> | 断开结果 |

**示例**：

```javascript
const handler = new BluetoothHandler();
await handler.disconnect();
```

---

#### 2.2.6 sendCommand

**功能**：发送命令到蓝牙设备

**参数**：

| 参数名  | 类型   | 说明     |
| ------- | ------ | -------- |
| command | Object | 命令对象 |

**命令对象结构**：

| 字段    | 类型    | 说明                                                        |
| ------- | ------- | ----------------------------------------------------------- |
| type    | string  | 命令类型 ('heartbeat', 'lightOn', 'lightOff', 'controlAll') |
| lightId | number  | 灯ID（仅 type='lightOn'/'lightOff' 时需要）                 |
| state   | boolean | 状态（仅 type='controlAll' 时需要）                         |

**返回值**：

| 类型            | 说明     |
| --------------- | -------- |
| Promise<Object> | 响应结果 |

**示例**：

```javascript
const handler = new BluetoothHandler();
const response = await handler.sendCommand({
  type: 'lightOn',
  lightId: 5,
});
```

---

#### 2.2.7 isConnected

**功能**：检查是否已连接

**参数**：无

**返回值**：

| 类型    | 说明       |
| ------- | ---------- |
| boolean | 是否已连接 |

**示例**：

```javascript
const handler = new BluetoothHandler();
const connected = handler.isConnected();
// connected = true/false
```

---

## 3. SerialPortHandler（串口通信处理器）

### 3.1 类定义

```javascript
class SerialPortHandler {
  constructor();
}
```

### 3.2 方法列表

#### 3.2.1 connect

**功能**：连接到串口

**参数**：

| 参数名   | 类型   | 说明                  |
| -------- | ------ | --------------------- |
| portName | string | 串口名称（如 'COM4'） |
| baudRate | number | 波特率（默认 115200） |

**返回值**：

| 类型          | 说明     |
| ------------- | -------- |
| Promise<void> | 连接结果 |

**示例**：

```javascript
const handler = new SerialPortHandler();
await handler.connect('COM4', 115200);
```

---

#### 3.2.2 disconnect

**功能**：断开串口连接

**参数**：无

**返回值**：

| 类型          | 说明     |
| ------------- | -------- |
| Promise<void> | 断开结果 |

**示例**：

```javascript
const handler = new SerialPortHandler();
await handler.disconnect();
```

---

#### 3.2.3 sendCommand

**功能**：发送命令到串口

**参数**：

| 参数名  | 类型   | 说明                            |
| ------- | ------ | ------------------------------- |
| command | Object | 命令对象（同 BluetoothHandler） |

**返回值**：

| 类型            | 说明     |
| --------------- | -------- |
| Promise<Object> | 响应结果 |

**示例**：

```javascript
const handler = new SerialPortHandler();
const response = await handler.sendCommand({
  type: 'lightOn',
  lightId: 5,
});
```

---

#### 3.2.4 isConnected

**功能**：检查是否已连接

**参数**：无

**返回值**：

| 类型    | 说明       |
| ------- | ---------- |
| boolean | 是否已连接 |

**示例**：

```javascript
const handler = new SerialPortHandler();
const connected = handler.isConnected();
```

---

## 4. StorageService（数据存储服务）

### 4.1 静态方法列表

#### 4.1.1 getDevices

**功能**：获取所有器件

**参数**：无

**返回值**：

| 类型                   | 说明     |
| ---------------------- | -------- |
| Promise<Array<Object>> | 器件数组 |

**器件对象结构**：

| 字段        | 类型   | 说明              |
| ----------- | ------ | ----------------- |
| id          | string | 器件ID            |
| supplierId  | string | 供应商编号        |
| name        | string | 器件名称          |
| function    | string | 功能描述          |
| resistance  | string | 电阻值（可选）    |
| voltage     | string | 电压值（可选）    |
| capacitance | string | 电容值（可选）    |
| inductance  | string | 电感值（可选）    |
| current     | string | 电流值（可选）    |
| shelf       | string | 器件架（A/B/C/D） |
| createdAt   | string | 创建时间          |
| updatedAt   | string | 更新时间          |

**示例**：

```javascript
const devices = await StorageService.getDevices();
// devices = [{ id: '1', name: '10Ω电阻器', ... }, ...]
```

---

#### 4.1.2 getDeviceById

**功能**：根据ID获取器件

**参数**：

| 参数名   | 类型   | 说明   |
| -------- | ------ | ------ |
| deviceId | string | 器件ID |

**返回值**：

| 类型           | 说明  |
| -------------- | ----- | -------------- |
| Promise<Object | null> | 器件对象或null |

**示例**：

```javascript
const device = await StorageService.getDeviceById('1');
```

---

#### 4.1.3 saveDevice

**功能**：保存器件

**参数**：

| 参数名 | 类型   | 说明     |
| ------ | ------ | -------- |
| device | Object | 器件对象 |

**返回值**：

| 类型          | 说明     |
| ------------- | -------- |
| Promise<void> | 保存结果 |

**示例**：

```javascript
await StorageService.saveDevice({
  id: '1',
  supplierId: 'C28323',
  name: '10Ω电阻器',
  function: '限流、分压',
  resistance: '10Ω',
  shelf: 'A',
});
```

---

#### 4.1.4 deleteDevice

**功能**：删除器件

**参数**：

| 参数名   | 类型   | 说明   |
| -------- | ------ | ------ |
| deviceId | string | 器件ID |

**返回值**：

| 类型          | 说明     |
| ------------- | -------- |
| Promise<void> | 删除结果 |

**示例**：

```javascript
await StorageService.deleteDevice('1');
```

---

#### 4.1.5 searchDevices

**功能**：搜索器件

**参数**：

| 参数名  | 类型   | 说明       |
| ------- | ------ | ---------- |
| keyword | string | 搜索关键词 |

**返回值**：

| 类型                   | 说明           |
| ---------------------- | -------------- |
| Promise<Array<Object>> | 匹配的器件数组 |

**示例**：

```javascript
const devices = await StorageService.searchDevices('电阻');
```

---

#### 4.1.6 filterByShelf

**功能**：按器件架筛选器件

**参数**：

| 参数名 | 类型   | 说明              |
| ------ | ------ | ----------------- |
| shelf  | string | 器件架（A/B/C/D） |

**返回值**：

| 类型                   | 说明             |
| ---------------------- | ---------------- |
| Promise<Array<Object>> | 筛选后的器件数组 |

**示例**：

```javascript
const devices = await StorageService.filterByShelf('A');
```

---

#### 4.1.7 getBOMs

**功能**：获取所有BOM配单

**参数**：无

**返回值**：

| 类型                   | 说明    |
| ---------------------- | ------- |
| Promise<Array<Object>> | BOM数组 |

**BOM对象结构**：

| 字段      | 类型          | 说明      |
| --------- | ------------- | --------- |
| id        | string        | BOM ID    |
| name      | string        | BOM名称   |
| items     | Array<Object> | BOM项列表 |
| createdAt | string        | 创建时间  |

**BOM项结构**：

| 字段     | 类型   | 说明                              |
| -------- | ------ | --------------------------------- |
| id       | string | 器件ID                            |
| name     | string | 器件名称                          |
| quantity | number | 数量                              |
| status   | string | 状态（'available'/'unavailable'） |

**示例**：

```javascript
const boms = await StorageService.getBOMs();
```

---

#### 4.1.8 saveBOM

**功能**：保存BOM配单

**参数**：

| 参数名 | 类型   | 说明    |
| ------ | ------ | ------- |
| bom    | Object | BOM对象 |

**返回值**：

| 类型          | 说明     |
| ------------- | -------- |
| Promise<void> | 保存结果 |

**示例**：

```javascript
await StorageService.saveBOM({
  id: '1',
  name: '项目A-BOM',
  items: [{ id: '1', name: '10Ω电阻器', quantity: 10 }],
});
```

---

#### 4.1.9 deleteBOM

**功能**：删除BOM配单

**参数**：

| 参数名 | 类型   | 说明   |
| ------ | ------ | ------ |
| bomId  | string | BOM ID |

**返回值**：

| 类型          | 说明     |
| ------------- | -------- |
| Promise<void> | 删除结果 |

**示例**：

```javascript
await StorageService.deleteBOM('1');
```

---

#### 4.1.10 getUsers

**功能**：获取所有用户

**参数**：无

**返回值**：

| 类型                   | 说明     |
| ---------------------- | -------- |
| Promise<Array<Object>> | 用户数组 |

**用户对象结构**：

| 字段      | 类型   | 说明                   |
| --------- | ------ | ---------------------- |
| id        | string | 用户ID                 |
| username  | string | 用户名                 |
| password  | string | 加密后的密码           |
| role      | string | 角色（'admin'/'user'） |
| createdAt | string | 创建时间               |

**示例**：

```javascript
const users = await StorageService.getUsers();
```

---

#### 4.1.11 saveUser

**功能**：保存用户

**参数**：

| 参数名 | 类型   | 说明     |
| ------ | ------ | -------- |
| user   | Object | 用户对象 |

**返回值**：

| 类型          | 说明     |
| ------------- | -------- |
| Promise<void> | 保存结果 |

**示例**：

```javascript
await StorageService.saveUser({
  id: '1',
  username: 'admin',
  password: 'encrypted_password',
  role: 'admin',
});
```

---

#### 4.1.12 login

**功能**：用户登录

**参数**：

| 参数名   | 类型   | 说明   |
| -------- | ------ | ------ |
| username | string | 用户名 |
| password | string | 密码   |

**返回值**：

| 类型           | 说明  |
| -------------- | ----- | -------------- |
| Promise<Object | null> | 用户对象或null |

**示例**：

```javascript
const user = await StorageService.login('admin', 'admin');
```

---

#### 4.1.13 backupData

**功能**：备份所有数据

**参数**：无

**返回值**：

| 类型            | 说明     |
| --------------- | -------- |
| Promise<Object> | 备份数据 |

**示例**：

```javascript
const backup = await StorageService.backupData();
```

---

#### 4.1.14 restoreData

**功能**：恢复数据

**参数**：

| 参数名 | 类型   | 说明     |
| ------ | ------ | -------- |
| data   | Object | 备份数据 |

**返回值**：

| 类型          | 说明     |
| ------------- | -------- |
| Promise<void> | 恢复结果 |

**示例**：

```javascript
await StorageService.restoreData(backupData);
```

---

## 附录：命令类型枚举

| 命令类型   | 说明       | 对应命令字 |
| ---------- | ---------- | ---------- |
| heartbeat  | 心跳       | 0x00       |
| lightOn    | 点亮灯     | 0x01       |
| lightOff   | 熄灭灯     | 0x02       |
| controlAll | 控制所有灯 | 0x03       |

---

## 附录：响应命令字映射

| 发送命令字 | 响应命令字 |
| ---------- | ---------- |
| 0x00       | 0x80       |
| 0x01       | 0x81       |
| 0x02       | 0x82       |
| 0x03       | 0x83       |
