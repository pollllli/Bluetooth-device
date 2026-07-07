/**
 * 蓝牙处理器模块
 * 负责蓝牙设备的扫描、连接、命令发送等功能
 * 使用 react-native-ble-plx 库进行蓝牙通信
 */
import { Platform } from 'react-native';
import CommandBuilder from './CommandBuilder';
import StorageService from './StorageService';

/**
 * 全局 btoa 函数兼容处理（Web平台可能不支持）
 * 将字符串编码为 Base64
 */
if (typeof btoa === 'undefined') {
  global.btoa = function (str) {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    let i = 0;

    for (; i < str.length; i += 3) {
      const a = str.charCodeAt(i) || 0;
      const b = str.charCodeAt(i + 1) || 0;
      const c = str.charCodeAt(i + 2) || 0;

      // 将3个字节编码为4个Base64字符
      result += chars[a >> 2];
      result += chars[((a & 3) << 4) | (b >> 4)];
      result += chars[((b & 15) << 2) | (c >> 6)];
      result += chars[c & 63];
    }

    // 根据剩余字节数添加填充
    const padding = str.length % 3;
    if (padding === 1) {
      // 剩余1个字节，需要2个=填充
      result = result.slice(0, -2) + '==';
    } else if (padding === 2) {
      // 剩余2个字节，需要1个=填充
      result = result.slice(0, -1) + '=';
    }

    return result;
  };
}

/**
 * 全局 atob 函数兼容处理（Web平台可能不支持）
 * 将 Base64 解码为字符串
 */
if (typeof atob === 'undefined') {
  global.atob = function (b64Encoded) {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let result = '';
    let i = 0;
    b64Encoded = b64Encoded.replace(/[^A-Za-z0-9+/=]/g, '');
    for (; i < b64Encoded.length; ) {
      const a = chars.indexOf(b64Encoded.charAt(i++));
      const b = chars.indexOf(b64Encoded.charAt(i++));
      const c = chars.indexOf(b64Encoded.charAt(i++));
      const d = chars.indexOf(b64Encoded.charAt(i++));
      result += String.fromCharCode((a << 2) | (b >> 4));
      if (c !== 64) result += String.fromCharCode(((b & 15) << 4) | (c >> 2));
      if (d !== 64) result += String.fromCharCode(((c & 3) << 6) | d);
    }
    return result;
  };
}

/**
 * 蓝牙管理器和扫描模式变量声明
 * 仅在非Web平台导入 react-native-ble-plx 库
 */
let BleManager, ScanMode;
if (Platform.OS !== 'web') {
  const blePlx = require('react-native-ble-plx');
  BleManager = blePlx.BleManager;
  ScanMode = blePlx.ScanMode;
}

/**
 * 蓝牙处理器类
 * 提供蓝牙设备的扫描、连接、命令发送等功能
 */
class BluetoothHandler {
  /**
   * 构造函数
   * 初始化命令构建器、连接状态和UUID配置
   */
  constructor() {
    // 初始化命令帧构建器
    this.commandBuilder = new CommandBuilder();
    // 当前连接的设备对象
    this.connectedDevice = null;
    // 蓝牙管理器实例
    this.manager = null;
    // 是否正在扫描设备
    this.isScanning = false;
    // 蓝牙是否已初始化
    this.isInitialized = false;
    // BLE服务UUID（默认使用W02模块配置，这是最常见的BLE透传模块）
        this.serviceUUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
        // 写入特征UUID（W02模块使用FFE2）
        this.writeCharacteristicUUID = '0000ffe2-0000-1000-8000-00805f9b34fb';
        // 读取特征UUID（W02模块使用FFE1）
        this.readCharacteristicUUID = '0000ffe1-0000-1000-8000-00805f9b34fb';
    // 最后一次心跳时间（用于检测连接状态）
    this.lastHeartbeatTime = 0;
    // 当前波特率（蓝牙模块内部串口波特率）
    this.currentBaudRate = 9600;
    // 是否启用自动发现UUID（当设备名称匹配到已知配置时禁用）
    this.autoDiscoveryEnabled = true;
    // 写入模式：'withResponse' 或 'withoutResponse'
    this.writeMode = 'withoutResponse';
    // 当前连接的设备类型
    this.deviceType = 'unknown';
    // 支持的波特率列表（用于自动检测）
    this.supportedBaudRates = [9600, 19200, 38400, 57600, 115200, 230400];
    // 是否已完成波特率检测
    this.baudRateDetected = false;
    // 心跳超时时间（毫秒），超过此时间未通信则认为断开
    this.heartbeatTimeout = 2000; // 2秒
    // 心跳响应等待超时（毫秒）：连接后发心跳，超过此时间未收到0x80响应则判定为非目标设备
    this.heartbeatResponseTimeout = 3000; // 3秒
    // 心跳响应 Promise 解析器（subscribeToCharacteristic 收到 0x80 响应时调用）
    this.heartbeatResponseResolver = null;
    // 心跳响应 Promise 拒绝器
    this.heartbeatResponseRejecter = null;
    // 连接日志（用于展示给用户）
    this.connectionLog = [];

    console.log('=== 蓝牙处理器初始化 ===');
    console.log('服务UUID:', this.serviceUUID);
    console.log('写入特征UUID:', this.writeCharacteristicUUID);
    console.log('读取特征UUID:', this.readCharacteristicUUID);
    console.log('心跳超时时间:', this.heartbeatTimeout, 'ms');
  }

  /**
   * 初始化蓝牙管理器
   * @returns {Object} 初始化结果对象
   * @returns {boolean} success - 是否成功
   * @returns {string} message - 结果消息
   */
  async initialize() {
    try {
      // Web平台不支持蓝牙功能
      if (Platform.OS === 'web') {
        console.log('Web平台不支持蓝牙功能');
        this.isInitialized = false;
        return { success: false, message: 'Web平台不支持蓝牙功能' };
      }

      // 创建蓝牙管理器实例
      this.manager = new BleManager();
      this.isInitialized = true;
      console.log('蓝牙初始化成功');
      return { success: true, message: '蓝牙初始化成功' };
    } catch (error) {
      console.error('蓝牙初始化失败:', error);
      this.isInitialized = false;
      return { success: false, message: '蓝牙初始化失败' };
    }
  }

  /**
   * 扫描蓝牙设备
   * @returns {Array<Object>} 扫描到的设备列表
   * @returns {string} id - 设备ID
   * @returns {string} name - 设备名称
   * @returns {number} rssi - 信号强度
   */
  async scanForDevices() {
    try {
      // Web平台不支持蓝牙功能
      if (Platform.OS === 'web') {
        console.log('Web平台不支持蓝牙功能');
        return [];
      }

      // 检查蓝牙管理器是否已初始化
      if (!this.isInitialized || !this.manager) {
        throw new Error('蓝牙管理器未初始化');
      }

      this.isScanning = true;
      console.log('开始扫描蓝牙设备');

      return new Promise((resolve, reject) => {
        const devices = [];
        // 扫描超时：2 秒（用户需求：尽量短的反馈时间 + 失败后让用户选择重扫）
        const scanTimeout = setTimeout(() => {
          this.manager.stopDeviceScan();
          this.isScanning = false;
          console.log('扫描超时（2s），返回设备列表:', devices);
          resolve(devices);
        }, 2000);

        // 开始扫描设备
        this.manager.startDeviceScan(
          null, // 不指定服务UUID，扫描所有设备
          { scanMode: ScanMode.LowLatency }, // 低延迟扫描模式
          (error, device) => {
            if (error) {
              console.error('扫描错误:', error);
              clearTimeout(scanTimeout);
              this.manager.stopDeviceScan();
              this.isScanning = false;
              reject(error);
              return;
            }

            // 过滤条件（用户需求）：
            //   1) 必须有名称
            //   2) RSSI 必须 > -80dBm（只保留信号较强的设备，过滤掉弱信号设备）
            //   3) 未重复的设备
            if (
              device.name &&
              typeof device.rssi === 'number' &&
              device.rssi > -80 &&
              !devices.some((d) => d.id === device.id)
            ) {
              devices.push({
                id: device.id,
                name: device.name,
                rssi: device.rssi,
              });
              console.log('发现设备:', device.name, device.id, device.rssi, 'dBm');
            } else if (device.name && typeof device.rssi === 'number' && device.rssi <= -80) {
              // 调试日志：记录被过滤的弱信号设备
              console.log('过滤弱信号设备:', device.name, device.id, device.rssi, 'dBm（<= -80）');
            }
          }
        );
      });
    } catch (error) {
      console.error('扫描设备失败:', error);
      this.isScanning = false;
      throw error;
    }
  }

  /**
   * 连接到指定的蓝牙设备
   * @param {string} deviceId - 设备ID
   * @returns {Object} 连接结果对象
   * @returns {boolean} success - 是否成功
   * @returns {string} message - 结果消息
   */
  async connectToDevice(deviceId) {
    try {
      // 清空之前的连接日志
      this.clearConnectionLog();
      
      // Web平台不支持蓝牙功能
      if (Platform.OS === 'web') {
        console.log('Web平台不支持蓝牙功能');
        throw new Error('Web平台不支持蓝牙功能');
      }

      // 检查蓝牙管理器是否已初始化
      if (!this.isInitialized || !this.manager) {
        throw new Error('蓝牙管理器未初始化');
      }

      this.addConnectionLog('info', '开始连接设备', { deviceId });

      // 连接到设备
      const device = await this.manager.connectToDevice(deviceId);
      this.addConnectionLog('success', 'BLE设备连接成功', { deviceName: device.name, deviceId: device.id });

      // 发现设备的所有服务和特征
      await device.discoverAllServicesAndCharacteristics();
      this.addConnectionLog('success', '服务和特征发现成功');

      // 保存连接的设备对象
      this.connectedDevice = device;

      // 添加设备断开监听器
      this.setupDisconnectionListener(device);

      // 根据设备名称选择合适的UUID配置
      this.selectUUIDByDeviceName(device.name);

      // 详细发现服务和特征并更新UUID
      await this.discoverServicesAndCharacteristics(device);
      this.addConnectionLog('success', '服务特征详细发现完成', {
        serviceUUID: this.serviceUUID,
        writeUUID: this.writeCharacteristicUUID,
        readUUID: this.readCharacteristicUUID
      });

      // 订阅notify特征（某些蓝牙模块必须订阅notify才能让数据透传生效）
      await this.subscribeToCharacteristic();
      this.addConnectionLog('success', 'Notify特征订阅成功');

      // 自动检测波特率并验证心跳
      // 关键: 蓝牙模块的 UART 波特率 (与 MCU 通信的速率) 与 BLE 链路无关, 取决于模块自身配置
      // 用户已确认: 只需要 9600 (CH9140 出厂默认), 不再支持 115200
      const baudCandidates = [9600];
      this.addConnectionLog('info', `波特率锁定 9600, 开始心跳验证`);
      let workingBaud = null;
      for (const baud of baudCandidates) {
        this.addConnectionLog('info', `【波特率 ${baud}】发送 AT+BAUD 切换`);
        await this.sendBaudRateCommand(baud);
        // 等 BT 模块切完波特率 (内部需要时间, 留 300ms)
        await new Promise((r) => setTimeout(r, 300));
        this.currentBaudRate = baud;

        this.addConnectionLog('info', `【波特率 ${baud}】发送心跳验证`);
        const ok = await this.verifyDeviceHeartbeat();
        if (ok) {
          workingBaud = baud;
          this.addConnectionLog('success', `心跳验证通过, 工作波特率锁定: ${baud}`);
          break;
        }
        this.addConnectionLog('warning', `【波特率 ${baud}】心跳无响应, 尝试下一个`);
      }

      if (workingBaud == null) {
        console.error(`✗ 波特率 9600 验证失败, MCU 未响应心跳`);
        // 主动断开连接
        await this.disconnect();
        throw new Error(
          `设备未响应心跳指令（波特率 9600, 连接已断开）。` +
          `请检查蓝牙模块 UART 波特率是否设置为 9600 并与 MCU 一致。`
        );
      }
      console.log(`✓ 心跳验证通过, 工作波特率: ${workingBaud}`);

      // 保存连接的设备信息，以便下次自动连接
      await StorageService.saveLastConnectedDevice({
        deviceId: device.id,
        deviceName: device.name || '未知设备',
        connectedAt: new Date().toISOString(),
      });

      console.log('=== 设备连接完成 ===');
      return { success: true, message: '设备连接成功' };
    } catch (error) {
      console.error('=== 连接设备失败 ===');
      console.error('错误详情:', error);
      console.error('错误消息:', error.message);
      console.error('错误堆栈:', error.stack);
      // 清理心跳验证相关状态
      this.heartbeatResponseResolver = null;
      this.heartbeatResponseRejecter = null;
      throw error;
    }
  }

  /**
   * 发送测试命令（用于调试）
   * @param {string} data - 要发送的数据（十六进制字符串或AT指令）
   * @param {boolean} isHex - 是否为十六进制格式
   */
  async sendTestCommand(data, isHex = false) {
    try {
      if (!this.connectedDevice || !this.manager) {
        return { success: false, message: '未连接设备' };
      }

      let frame;
      if (isHex) {
        // 十六进制格式
        frame = data.match(/.{1,2}/g).map((byte) => parseInt(byte, 16));
      } else {
        // ASCII字符串格式
        frame = data.split('').map((char) => char.charCodeAt(0));
      }

      console.log('=== 发送测试命令 ===');
      console.log('原始数据:', data);
      console.log('转换后的字节:', frame);
      console.log('十六进制:', frame.map((b) => b.toString(16).padStart(2, '0')).join(' '));

      const base64Data = this.bytesToBase64(frame);
      
      // 尝试发送
      try {
        await this.manager.writeCharacteristicWithoutResponseForDevice(
          this.connectedDevice.id,
          this.serviceUUID,
          this.writeCharacteristicUUID,
          base64Data
        );
        console.log('测试命令发送成功');
        return { success: true, message: '发送成功', data: frame };
      } catch (error) {
        console.error('测试命令发送失败:', error);
        return { success: false, message: '发送失败: ' + error.message };
      }
    } catch (error) {
      return { success: false, message: '错误: ' + error.message };
    }
  }

  /**
   * 根据设备名称选择合适的UUID配置
   * @param {string} deviceName - 设备名称
   */
  selectUUIDByDeviceName(deviceName) {
    console.log('=== 根据设备名称选择UUID配置 ===');
    console.log('设备名称:', deviceName);

    // 设备名称映射表
    const deviceUUIDMap = {
      // 新模块：W02开头的设备（根据W02模块官方文档）
      W02: {
          serviceUUID: '0000ffe0-0000-1000-8000-00805f9b34fb',
          writeCharacteristicUUID: '0000ffe2-0000-1000-8000-00805f9b34fb',
          readCharacteristicUUID: '0000ffe1-0000-1000-8000-00805f9b34fb',
        },
      // 旧模块：CH9140开头的设备
      CH9140: {
        serviceUUID: '0000fff0-0000-1000-8000-00805f9b34fb',
        writeCharacteristicUUID: '0000fff2-0000-1000-8000-00805f9b34fb', // 只写通道
        readCharacteristicUUID: '0000fff1-0000-1000-8000-00805f9b34fb', // 通知通道
      },
      // 其他常见蓝牙模块
      JDY: {
        serviceUUID: '0000ffe0-0000-1000-8000-00805f9b34fb',
        writeCharacteristicUUID: '0000ffe1-0000-1000-8000-00805f9b34fb',
        readCharacteristicUUID: '0000ffe1-0000-1000-8000-00805f9b34fb',
      },
    };

    // 查找匹配的配置
    let matchedConfig = null;
    for (const [prefix, config] of Object.entries(deviceUUIDMap)) {
      if (deviceName && deviceName.toUpperCase().includes(prefix)) {
        matchedConfig = config;
        console.log(`找到匹配的设备配置: ${prefix}`);
        break;
      }
    }

    // 如果找到匹配配置，更新UUID
    if (matchedConfig) {
      this.serviceUUID = matchedConfig.serviceUUID;
      this.writeCharacteristicUUID = matchedConfig.writeCharacteristicUUID;
      this.readCharacteristicUUID = matchedConfig.readCharacteristicUUID;
      // 保存设备类型
      for (const [prefix, config] of Object.entries(deviceUUIDMap)) {
        if (deviceName && deviceName.toUpperCase().includes(prefix)) {
          this.deviceType = prefix;
          break;
        }
      }
      // 设置写入模式（如果配置了）
      if (matchedConfig.writeMode) {
        this.writeMode = matchedConfig.writeMode;
      }
      // 禁用自动发现，使用已知的正确配置
      this.autoDiscoveryEnabled = false;
      console.log('更新UUID配置:', {
        serviceUUID: this.serviceUUID,
        writeCharacteristicUUID: this.writeCharacteristicUUID,
        readCharacteristicUUID: this.readCharacteristicUUID,
        deviceType: this.deviceType,
        writeMode: this.writeMode,
      });
      console.log('已禁用自动发现UUID，使用已知配置');
    } else {
      // 如果没有匹配，使用默认值，让自动发现来处理
      this.autoDiscoveryEnabled = true;
      this.deviceType = 'unknown';
      this.writeMode = 'withoutResponse';
      console.log('未找到匹配的设备配置，将使用自动发现功能');
    }

    console.log('=== UUID配置选择完成 ===');
  }

  /**
   * 发送AT指令配置蓝牙模块波特率
   * @param {number} baudRate - 波特率值
   * @returns {boolean} 是否发送成功
   */
  async sendBaudRateCommand(baudRate) {
    try {
      if (!this.connectedDevice || !this.manager) {
        console.log('未连接设备，无法配置波特率');
        return false;
      }

      // AT指令格式：AT+BAUDx (x对应波特率)
      // AT+BAUD1 = 1200
      // AT+BAUD2 = 2400
      // AT+BAUD3 = 4800
      // AT+BAUD4 = 9600 (默认)
      // AT+BAUD5 = 19200
      // AT+BAUD6 = 38400
      // AT+BAUD7 = 57600
      // AT+BAUD8 = 115200
      // AT+BAUD9 = 230400
      
      const baudMap = {
        1200: 'AT+BAUD1\r\n',
        2400: 'AT+BAUD2\r\n',
        4800: 'AT+BAUD3\r\n',
        9600: 'AT+BAUD4\r\n',
        19200: 'AT+BAUD5\r\n',
        38400: 'AT+BAUD6\r\n',
        57600: 'AT+BAUD7\r\n',
        115200: 'AT+BAUD8\r\n',
        230400: 'AT+BAUD9\r\n',
      };

      const command = baudMap[baudRate];
      if (!command) {
        console.log(`不支持的波特率: ${baudRate}`);
        return false;
      }

      // 将AT指令转换为字节数组
      const frame = command.split('').map(char => char.charCodeAt(0));
      const base64Data = this.bytesToBase64(frame);

      console.log(`=== 发送波特率配置指令 ===`);
      console.log(`波特率: ${baudRate}`);
      console.log(`AT指令: ${command.trim()}`);

      await this.manager.writeCharacteristicWithoutResponseForDevice(
        this.connectedDevice.id,
        this.serviceUUID,
        this.writeCharacteristicUUID,
        base64Data
      );

      // 等待模块响应
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log(`波特率 ${baudRate} 配置指令发送成功`);
      return true;
    } catch (error) {
      console.error('发送波特率配置指令失败:', error);
      return false;
    }
  }

  /**
   * 发送AT指令配置串口参数（数据位、停止位、校验位）
   * @param {number} dataBits - 数据位 (7 or 8)
   * @param {number} stopBits - 停止位 (1 or 2)
   * @param {string} parity - 校验位 (N-无校验, O-奇校验, E-偶校验)
   * @returns {boolean} 是否发送成功
   */
  async sendSerialConfigCommand(dataBits = 8, stopBits = 1, parity = 'N') {
    try {
      if (!this.connectedDevice || !this.manager) {
        console.log('未连接设备，无法配置串口参数');
        return false;
      }

      // AT指令格式：AT+DATABITSx (x=7或8)
      // AT指令格式：AT+STOPx (x=1或2)
      // AT指令格式：AT+PARITYx (x=N/O/E)
      
      const dataBitCmd = `AT+DATABITS${dataBits}\r\n`;
      const stopBitCmd = `AT+STOP${stopBits}\r\n`;
      const parityCmd = `AT+PARITY${parity}\r\n`;

      console.log(`=== 发送串口参数配置指令 ===`);
      console.log(`数据位: ${dataBits}, 停止位: ${stopBits}, 校验位: ${parity}`);

      // 发送数据位配置
      let frame = dataBitCmd.split('').map(char => char.charCodeAt(0));
      let base64Data = this.bytesToBase64(frame);
      await this.manager.writeCharacteristicWithoutResponseForDevice(
        this.connectedDevice.id,
        this.serviceUUID,
        this.writeCharacteristicUUID,
        base64Data
      );
      await new Promise(resolve => setTimeout(resolve, 200));

      // 发送停止位配置
      frame = stopBitCmd.split('').map(char => char.charCodeAt(0));
      base64Data = this.bytesToBase64(frame);
      await this.manager.writeCharacteristicWithoutResponseForDevice(
        this.connectedDevice.id,
        this.serviceUUID,
        this.writeCharacteristicUUID,
        base64Data
      );
      await new Promise(resolve => setTimeout(resolve, 200));

      // 发送校验位配置
      frame = parityCmd.split('').map(char => char.charCodeAt(0));
      base64Data = this.bytesToBase64(frame);
      await this.manager.writeCharacteristicWithoutResponseForDevice(
        this.connectedDevice.id,
        this.serviceUUID,
        this.writeCharacteristicUUID,
        base64Data
      );
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log('串口参数配置指令发送成功');
      return true;
    } catch (error) {
      console.error('发送串口参数配置指令失败:', error);
      return false;
    }
  }

  /**
   * 发送AT指令保存配置（重启后生效）
   * @returns {boolean} 是否发送成功
   */
  async sendSaveConfigCommand() {
    try {
      if (!this.connectedDevice || !this.manager) {
        console.log('未连接设备，无法保存配置');
        return false;
      }

      const command = 'AT+SAVE\r\n';
      const frame = command.split('').map(char => char.charCodeAt(0));
      const base64Data = this.bytesToBase64(frame);

      console.log(`=== 发送保存配置指令 ===`);
      console.log(`AT指令: ${command.trim()}`);

      await this.manager.writeCharacteristicWithoutResponseForDevice(
        this.connectedDevice.id,
        this.serviceUUID,
        this.writeCharacteristicUUID,
        base64Data
      );

      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('保存配置指令发送成功');
      return true;
    } catch (error) {
      console.error('发送保存配置指令失败:', error);
      return false;
    }
  }

  /**
   * 发送AT指令查询模块信息
   * @returns {Object|null} 模块信息，失败返回null
   */
  async sendQueryInfoCommand() {
    try {
      if (!this.connectedDevice || !this.manager) {
        console.log('未连接设备，无法查询模块信息');
        return null;
      }

      const command = 'AT+INFO\r\n';
      const frame = command.split('').map(char => char.charCodeAt(0));
      const base64Data = this.bytesToBase64(frame);

      console.log(`=== 发送查询信息指令 ===`);
      console.log(`AT指令: ${command.trim()}`);

      await this.manager.writeCharacteristicWithoutResponseForDevice(
        this.connectedDevice.id,
        this.serviceUUID,
        this.writeCharacteristicUUID,
        base64Data
      );

      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('查询信息指令发送成功');
      return true;
    } catch (error) {
      console.error('发送查询信息指令失败:', error);
      return false;
    }
  }

  /**
   * 检测蓝牙连接状态
   * 注意：蓝牙模块与MCU之间的串口波特率需预先配置一致
   * @returns {number} 返回默认波特率9600（蓝牙模块常见出厂默认值）
   */
  async autoDetectBaudRate() {
    try {
      if (!this.connectedDevice || !this.manager) {
        console.log('未连接设备');
        return null;
      }

      console.log('=== 检测蓝牙连接状态 ===');
      // 注意：这里不发送心跳命令！避免与 verifyDeviceHeartbeat 重复发送
      // 导致 MCU 第一次响应被丢弃。
      // 实际波特率需要在硬件层面配置（蓝牙模块和 MCU 必须一致）

      this.currentBaudRate = 9600;
      return this.currentBaudRate;
    } catch (error) {
      console.error('通信检测异常:', error);
      return null;
    }
  }

  /**
   * 获取当前波特率
   * @returns {number} 当前波特率
   */
  getCurrentBaudRate() {
    return this.currentBaudRate;
  }

  /**
   * 设置波特率（手动设置）
   * @param {number} baudRate - 波特率值
   * @returns {boolean} 是否设置成功
   */
  async setBaudRate(baudRate) {
    if (this.supportedBaudRates.includes(baudRate)) {
      this.currentBaudRate = baudRate;
      await this.sendBaudRateCommand(baudRate);
      return true;
    }
    console.log(`不支持的波特率: ${baudRate}`);
    return false;
  }

  /**
   * 详细发现设备的服务和特征
   * 自动查找可写和可读特征，并更新UUID配置
   * @param {Object} device - 设备对象
   */
  async discoverServicesAndCharacteristics(device) {
    try {
      // Web平台不支持蓝牙功能
      if (Platform.OS === 'web') {
        console.log('Web平台不支持蓝牙功能');
        return;
      }

      console.log('=== 开始详细发现服务和特征 ===');
      const services = await device.services();
      console.log('发现的服务数量:', services.length);

      let foundWritableCharacteristic = null;
      let foundReadableCharacteristic = null;

      // 遍历所有服务
      for (const service of services) {
        console.log('\n服务UUID:', service.uuid);
        console.log('服务对象:', service);
        const characteristics = await service.characteristics();
        console.log('  特征数量:', characteristics.length);

        // 遍历服务的所有特征
        for (const characteristic of characteristics) {
          console.log('  特征UUID:', characteristic.uuid);
          console.log('  特征对象:', characteristic);
          console.log('  可写属性:', {
            isWritableWithResponse: characteristic.isWritableWithResponse,
            isWritableWithoutResponse: characteristic.isWritableWithoutResponse,
          });
          console.log('  可读属性:', characteristic.isReadable);
          console.log('  可通知属性:', characteristic.isNotifiable);
          console.log('  可指示属性:', characteristic.isIndicatable);

          // 查找可写特征（优先有响应写入，其次无响应写入）
          // 优先匹配已知的串口透传服务UUID
          const isKnownService = 
            service.uuid.toLowerCase().includes('fff0') || 
            service.uuid.toLowerCase().includes('ff12') ||
            service.uuid.toLowerCase().includes('ffe0');
          
          if (
            !foundWritableCharacteristic &&
            (characteristic.isWritableWithResponse ||
              characteristic.isWritableWithoutResponse) &&
            (isKnownService || this.serviceUUID === null)
          ) {
            foundWritableCharacteristic = {
              serviceUUID: service.uuid,
              characteristicUUID: characteristic.uuid,
              isWritableWithResponse: characteristic.isWritableWithResponse,
              isWritableWithoutResponse:
                characteristic.isWritableWithoutResponse,
            };
            console.log('  找到可写特征:', foundWritableCharacteristic);
          }

          // 查找可读特征（优先匹配已知服务）
          if (!foundReadableCharacteristic && characteristic.isReadable && (isKnownService || this.readCharacteristicUUID === null)) {
            foundReadableCharacteristic = {
              serviceUUID: service.uuid,
              characteristicUUID: characteristic.uuid,
            };
            console.log('  找到可读特征:', foundReadableCharacteristic);
          }
        }
      }

      // 更新写入特征UUID（仅在启用自动发现时更新，避免覆盖已知模块的正确配置）
      if (this.autoDiscoveryEnabled && foundWritableCharacteristic) {
        this.serviceUUID = foundWritableCharacteristic.serviceUUID;
        this.writeCharacteristicUUID =
          foundWritableCharacteristic.characteristicUUID;
        console.log('=== 更新为找到的可写特征 ===');
        console.log('服务UUID:', this.serviceUUID);
        console.log('写入特征UUID:', this.writeCharacteristicUUID);
      } else if (!this.autoDiscoveryEnabled) {
        console.log('=== 自动发现已禁用，保留已知的UUID配置 ===');
        console.log('服务UUID:', this.serviceUUID);
        console.log('写入特征UUID:', this.writeCharacteristicUUID);
        console.log('读取特征UUID:', this.readCharacteristicUUID);
      }

      // 更新读取特征UUID（仅在启用自动发现时更新）
      if (this.autoDiscoveryEnabled && foundReadableCharacteristic) {
        this.readCharacteristicUUID =
          foundReadableCharacteristic.characteristicUUID;
        console.log('=== 更新为找到的可读特征 ===');
        console.log('读取特征UUID:', this.readCharacteristicUUID);
      }

      // 对于CH9140设备，尝试自动发现特征（即使禁用了自动发现）
      // CH9140的UUID可能存在大小写或格式差异
      if (this.deviceType === 'CH9140' && foundWritableCharacteristic) {
        console.log('=== CH9140设备特殊处理 ===');
        console.log('发现的可写特征UUID:', foundWritableCharacteristic.characteristicUUID);
        console.log('配置的写入特征UUID:', this.writeCharacteristicUUID);
        
        // 检查是否匹配
        const foundUUID = foundWritableCharacteristic.characteristicUUID.toLowerCase();
        const configUUID = this.writeCharacteristicUUID.toLowerCase();
        
        if (foundUUID !== configUUID) {
          console.log('发现的特征与配置不匹配，更新为发现的特征');
          this.writeCharacteristicUUID = foundWritableCharacteristic.characteristicUUID;
          this.serviceUUID = foundWritableCharacteristic.serviceUUID;
          console.log('更新后服务UUID:', this.serviceUUID);
          console.log('更新后写入特征UUID:', this.writeCharacteristicUUID);
        }
      }

      console.log('=== 服务和特征发现完成 ===');
    } catch (error) {
      console.error('发现服务和特征失败:', error);
    }
  }

  /**
   * 订阅notify特征（某些蓝牙模块必须订阅notify才能让数据透传生效）
   */
  async subscribeToCharacteristic() {
    try {
      if (!this.connectedDevice || !this.manager) {
        console.log('未连接设备，无法订阅特征');
        return;
      }

      console.log('=== 开始订阅notify特征 ===');
      console.log('服务UUID:', this.serviceUUID);
      console.log('读取特征UUID:', this.readCharacteristicUUID);

      const services = await this.connectedDevice.services();
      const service = services.find((s) => s.uuid === this.serviceUUID);
      
      if (!service) {
        console.error('未找到服务');
        return;
      }

      const characteristics = await service.characteristics();
      const characteristic = characteristics.find(
        (c) => c.uuid === this.readCharacteristicUUID
      );

      if (!characteristic) {
        console.error('未找到读取特征');
        return;
      }

      if (!characteristic.isNotifiable) {
        console.log('该特征不支持notify，跳过订阅');
        return;
      }

      console.log('开始订阅notify...');
      await this.manager.monitorCharacteristicForDevice(
        this.connectedDevice.id,
        this.serviceUUID,
        this.readCharacteristicUUID,
        (error, characteristicData) => {
          if (error) {
            // 静默处理设备断开时的 notify 错误, 避免 RN LogBox 弹"上次运行出错"
            // 设备物理断开是正常状态, 错误会通过 onDisconnected 单独处理
            const msg = (error && error.message) || String(error);
            if (msg.includes('disconnected') || msg.includes('Disconnect')) {
              console.log('设备已断开, notify 回调终止 (静默)');
            } else {
              console.warn('notify 回调异常:', msg);
            }
            return;
          }
          console.log('收到notify数据:', characteristicData);

          // 解析 MCU 响应帧，检测心跳响应（0x80）等指令
          if (characteristicData && characteristicData.value) {
            try {
              const bytes = this.base64ToBytes(characteristicData.value);
              const byteArray = Array.from(bytes);
              const hexString = byteArray.map((b) => b.toString(16).padStart(2, '0')).join(' ');
              
              const response = this.commandBuilder.parseResponse(byteArray);

              if (response && response.isValid) {
                const cmdName = this.commandBuilder.getCommandName(response.command);
                // 记录接收日志
                this.addConnectionLog('receive', `收到响应: ${cmdName}`, {
                  hex: hexString,
                  length: byteArray.length,
                  command: '0x' + response.command.toString(16),
                  data: response.data.map((b) => '0x' + b.toString(16)).join(' ')
                });

                // 心跳响应：0x80 = RESPONSE_HEARTBEAT
                if (response.command === 0x80) {
                  if (typeof this.heartbeatResponseResolver === 'function') {
                    const resolver = this.heartbeatResponseResolver;
                    this.heartbeatResponseResolver = null;
                    this.heartbeatResponseRejecter = null;
                    resolver(true);
                  }
                } else {
                  // 非心跳响应（如点亮/熄灭响应）
                  console.log('收到非心跳响应:', cmdName, '(0x' + response.command.toString(16) + ')');
                  console.log('当前 heartbeatResponseResolver 状态:', typeof this.heartbeatResponseResolver);
                }
              } else {
                console.log('notify 数据不是有效帧（可能不是我们的设备）');
                console.log('解析结果:', response);
              }
            } catch (parseError) {
              console.error('解析 notify 数据失败:', parseError);
            }
          }
        }
      );

      console.log('=== notify订阅成功 ===');
    } catch (error) {
      console.error('订阅notify特征失败:', error);
    }
  }

  /**
   * 发送命令到蓝牙设备
   * @param {Object} command - 命令对象
   * @param {string} command.type - 命令类型：'lightOn', 'lightOff', 'heartbeat', 'controlAll'
   * @param {number} [command.lightId] - 灯的ID（用于lightOn/lightOff命令）
   * @param {boolean} [command.state] - 状态（用于controlAll命令，true=点亮，false=熄灭）
   * @returns {Object} 发送结果对象
   * @returns {boolean} success - 是否成功
   * @returns {string} message - 结果消息
   * @returns {number} [cmd] - 响应命令字（成功时返回）
   * @returns {Array} [data] - 响应数据（成功时返回）
   */
  async sendCommand(command) {
    try {
      // Web平台不支持蓝牙功能
      if (Platform.OS === 'web') {
        console.log('Web平台不支持蓝牙功能');
        return {
          success: false,
          message: 'Web平台不支持蓝牙功能',
        };
      }

      // 检查设备是否已连接
      if (!this.connectedDevice || !this.manager) {
        console.error('未连接设备');
        return {
          success: false,
          message: '未连接设备',
        };
      }

      const deviceId = this.connectedDevice.id;
      console.log('设备ID:', deviceId);
      console.log('命令类型:', command.type);

      // 检查必要参数
      if (!deviceId || !this.serviceUUID || !this.writeCharacteristicUUID) {
        console.error('缺少必要的参数:', {
          deviceId,
          serviceUUID: this.serviceUUID,
          characteristicUUID: this.writeCharacteristicUUID,
        });
        return {
          success: false,
          message: '缺少必要的参数',
        };
      }

      console.log('使用的UUID:', {
        serviceUUID: this.serviceUUID,
        characteristicUUID: this.writeCharacteristicUUID,
      });

      // 根据命令类型构建命令帧
      let frame;
      if (command.type === 'lightOn') {
        // 点亮指定灯
        frame = this.commandBuilder.buildLightOnCommand(command.lightId != null ? command.lightId : 1);
      } else if (command.type === 'lightOff') {
        frame = this.commandBuilder.buildLightOffCommand(command.lightId != null ? command.lightId : 1);
      } else if (command.type === 'heartbeat') {
        // 心跳命令
        frame = this.commandBuilder.buildHeartbeatCommand();
      } else if (command.type === 'controlAll') {
        // 控制所有灯
        frame = this.commandBuilder.buildControlAllLightsCommand(
          command.state !== undefined ? command.state : true
        );
      } else {
        // 默认发送心跳命令
        frame = this.commandBuilder.buildHeartbeatCommand();
      }

      console.log('构建的命令帧:', frame);

      try {
        console.log('=== 开始发送命令 ===');
        console.log('设备ID:', deviceId);
        console.log('服务UUID:', this.serviceUUID);
        console.log('写入特征UUID:', this.writeCharacteristicUUID);
        console.log('命令帧:', frame);
        console.log('命令帧长度:', frame.length);
        console.log(
          '命令帧Hex:',
          frame.map((b) => b.toString(16).padStart(2, '0')).join(' ')
        );

        // 检查设备连接状态
        try {
          const isConnected = await this.connectedDevice.isConnected();
          console.log('设备连接状态:', isConnected);
          if (!isConnected) {
            console.error('设备已断开连接');
            return {
              success: false,
              message: '设备已断开连接',
            };
          }
        } catch (error) {
          console.error('检查设备连接状态失败:', error);
        }

        // 再次发现服务和特征（确保UUID正确）
        try {
          const services = await this.connectedDevice.services();
          console.log('发现的服务数量:', services.length);
          for (const service of services) {
            console.log('服务UUID:', service.uuid);
            const characteristics = await service.characteristics();
            console.log('  特征数量:', characteristics.length);
            for (const characteristic of characteristics) {
              console.log('  特征UUID:', characteristic.uuid);
              console.log('  特征可写属性:', {
                isWritableWithResponse: characteristic.isWritableWithResponse,
                isWritableWithoutResponse:
                  characteristic.isWritableWithoutResponse,
              });
              console.log('  特征可读属性:', characteristic.isReadable);
              console.log('  特征可通知属性:', characteristic.isNotifiable);
            }
          }

          // 查找服务和特征对象
          const service = services.find((s) => s.uuid === this.serviceUUID);
          if (service) {
            const characteristics = await service.characteristics();
            const characteristic = characteristics.find(
              (c) => c.uuid === this.writeCharacteristicUUID
            );
            if (characteristic) {
              console.log('写入特征对象:', characteristic);
              console.log('写入特征可写属性:', {
                isWritableWithResponse: characteristic.isWritableWithResponse,
                isWritableWithoutResponse:
                  characteristic.isWritableWithoutResponse,
              });
            } else {
              console.error('未找到写入特征');
            }
          } else {
            console.error('未找到服务');
          }
        } catch (error) {
          console.error('获取特征对象失败:', error);
        }

        // 将字节数组转换为Base64编码
        const base64Data = this.bytesToBase64(frame);
        console.log('字节帧Base64编码:', base64Data);

        // 尝试发送命令（按优先级尝试不同的写入方式）
        console.log('=== 尝试发送命令 ===');
        console.log('写入特征UUID:', this.writeCharacteristicUUID);
        console.log('数据长度:', frame.length);
        console.log('设备类型:', this.deviceType);
        
        let writeSuccess = false;
        
        // 方式1: 尝试使用有响应写入（某些模块只支持这种方式）
        console.log('方式1: 尝试使用有响应写入...');
        try {
          await this.manager.writeCharacteristicWithResponseForDevice(
            deviceId,
            this.serviceUUID,
            this.writeCharacteristicUUID,
            base64Data
          );
          console.log('有响应写入成功');
          writeSuccess = true;
        } catch (responseError) {
          console.error('方式1失败:', responseError.message);
        }
        
        // 方式2: 尝试使用无响应写入
        if (!writeSuccess) {
          console.log('方式2: 尝试使用无响应写入...');
          try {
            await this.manager.writeCharacteristicWithoutResponseForDevice(
              deviceId,
              this.serviceUUID,
              this.writeCharacteristicUUID,
              base64Data
            );
            console.log('无响应写入成功');
            writeSuccess = true;
          } catch (error) {
            console.error('方式2失败:', error.message);
          }
        }
        
        // 方式3: 尝试使用设备对象直接写入（某些模块只支持这种方式）
        if (!writeSuccess) {
          console.log('方式3: 尝试使用设备对象直接写入...');
          try {
            if (this.connectedDevice && this.connectedDevice.writeCharacteristic) {
              const services = await this.connectedDevice.services();
              const service = services.find((s) => s.uuid === this.serviceUUID);
              if (service) {
                const characteristics = await service.characteristics();
                const characteristic = characteristics.find(
                  (c) => c.uuid === this.writeCharacteristicUUID
                );
                if (characteristic) {
                  console.log('找到特征对象，尝试直接写入...');
                  // 将帧转换为Uint8Array（某些模块要求必须是Uint8Array）
                  const uint8Frame = new Uint8Array(frame);
                  // 优先尝试有响应写入，某些模块只支持这种方式
                  if (characteristic.writeWithResponse) {
                    await characteristic.writeWithResponse(uint8Frame);
                  } else if (characteristic.writeWithoutResponse) {
                    await characteristic.writeWithoutResponse(uint8Frame);
                  } else if (characteristic.write) {
                    await characteristic.write(uint8Frame);
                  }
                  console.log('设备对象直接写入成功');
                  writeSuccess = true;
                }
              }
            }
          } catch (error) {
            console.error('方式3失败:', error.message);
          }
        }
        
        // 方式4: 尝试使用设备对象直接写入(使用base64)
        if (!writeSuccess) {
          console.log('方式4: 尝试使用设备对象直接写入(使用base64)...');
          try {
            const services = await this.connectedDevice.services();
            const service = services.find((s) => s.uuid === this.serviceUUID);
            if (service) {
              const characteristics = await service.characteristics();
              const characteristic = characteristics.find(
                (c) => c.uuid === this.writeCharacteristicUUID
              );
              if (characteristic) {
                // 优先尝试有响应写入
                if (characteristic.isWritableWithResponse) {
                  await characteristic.writeWithResponse(base64Data);
                  console.log('设备对象有响应写入成功');
                  writeSuccess = true;
                } else if (characteristic.isWritableWithoutResponse) {
                  await characteristic.writeWithoutResponse(base64Data);
                  console.log('设备对象无响应写入成功');
                  writeSuccess = true;
                } else {
                  throw new Error('特征不可写');
                }
              } else {
                throw new Error('未找到写入特征');
              }
            } else {
              throw new Error('未找到服务');
            }
          } catch (directError) {
            console.error('方式4失败:', directError.message);
          }
        }

        if (!writeSuccess) {
          console.error('所有写入方式都失败了！');
          return {
            success: false,
            message: '无法发送命令到设备',
          };
        }

        console.log('发送命令成功');
        console.log('=== 发送命令完成 ===');

        // 更新心跳时间
        this.updateHeartbeat();

        return {
          cmd: frame[2] | 0x80, // 返回响应命令字（原命令字 | 0x80）
          data: [0x01], // 返回成功数据
          success: true,
        };
      } catch (error) {
        console.error('=== 发送命令失败 ===');
        console.error('错误详情:', error);
        console.error('错误消息:', error.message);
        console.error('错误堆栈:', error.stack);
        return {
          success: false,
          message: error.message || '发送命令失败',
        };
      }
    } catch (error) {
      console.error('发送命令失败:', error);
      console.error('错误详情:', error.message, error.stack);
      return {
        success: false,
        message: error.message || '发送命令失败',
      };
    }
  }

  /**
   * 快速"全灭"指令 - 专为切库场景设计
   *
   * 为什么不直接用 sendCommand?
   *   sendCommand 内部先尝试 writeCharacteristicWithResponseForDevice (等 ACK),
   *   如果 BLE 链路实际已死 (例如 App 在后台被 OS 挂起后回前台), 这个调用会
   *   **卡死直到超时**(几秒甚至更长), 等它走完 WithResponse → WithoutResponse
   *   → ... 全部 fallback, 已经过 5-10 秒, 用户体验上就是"切库了但灯还亮着".
   *
   * 本方法:
   *   - 只走 writeCharacteristicWithoutResponseForDevice (fire-and-forget, 不等 ACK)
   *   - 1.5 秒硬超时
   *   - 失败返回 { success: false, timedOut: true }, 抛不抛错由调用方决定
   *   - 不调 isConnected() 检查, 因为 BLE 链路挂起时 isConnected 仍可能返回 true
   *
   * 调用方一般用 try/catch 抓住, 切库主流程不阻塞。
   */
  async fastControlAll(state) {
    const TIMEOUT_MS = 1500;
    if (Platform.OS === 'web') return { success: false, reason: 'web' };
    if (!this.connectedDevice || !this.manager) {
      return { success: false, reason: 'no-connection' };
    }
    if (!this.serviceUUID || !this.writeCharacteristicUUID) {
      return { success: false, reason: 'no-uuid' };
    }
    let frame;
    try {
      frame = this.commandBuilder.buildControlAllLightsCommand(state !== false);
    } catch (e) {
      return { success: false, reason: 'build-failed', error: e };
    }
    const base64Data = this.bytesToBase64(frame);
    const deviceId = this.connectedDevice.id;
    try {
      await Promise.race([
        this.manager.writeCharacteristicWithoutResponseForDevice(
          deviceId,
          this.serviceUUID,
          this.writeCharacteristicUUID,
          base64Data
        ),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('fastControlAll 超时 (' + TIMEOUT_MS + 'ms)')),
            TIMEOUT_MS
          )
        ),
      ]);
      return { success: true };
    } catch (e) {
      return { success: false, reason: 'write-failed', error: e };
    }
  }

  /**
   * 断开与蓝牙设备的连接
   */
  /**
   * 更新心跳时间（在发送命令时调用）
   * 用于检测蓝牙连接状态
   */
  updateHeartbeat() {
    this.lastHeartbeatTime = Date.now();
    console.log('心跳时间已更新:', this.lastHeartbeatTime);
  }

  /**
   * 检查心跳状态（判断是否超时）
   * @returns {boolean} - 是否在心跳超时时间内
   */
  isHeartbeatAlive() {
    const now = Date.now();
    const elapsed = now - this.lastHeartbeatTime;
    const isAlive = elapsed <= this.heartbeatTimeout;
    console.log(
      '心跳检查 - 已过去:',
      elapsed,
      'ms, 超时时间:',
      this.heartbeatTimeout,
      'ms, 状态:',
      isAlive ? '正常' : '超时'
    );
    return isAlive;
  }

  /**
   * 设置设备断开监听器
   * 监听蓝牙设备物理断开事件（如拔掉模块）
   * @param {Object} device - 蓝牙设备对象
   */
  setupDisconnectionListener(device) {
    if (Platform.OS === 'web') {
      return;
    }

    // 监听设备断开事件
    device.onDisconnected((error, disconnectedDevice) => {
      console.log('=== 检测到蓝牙设备断开 ===');
      console.log('断开的设备:', disconnectedDevice?.name);
      console.log('错误信息:', error);

      // 清除连接状态
      this.connectedDevice = null;

      // 清除全局连接状态
      if (global.deviceConnection && global.deviceConnection.handler === this) {
        delete global.deviceConnection;
        console.log('全局连接状态已清除（设备物理断开）');

        // 触发全局事件通知UI更新
        if (typeof global.onBluetoothDisconnected === 'function') {
          console.log('通知UI蓝牙已断开');
          global.onBluetoothDisconnected();
        }
      }
    });
  }

  /**
   * 发送心跳命令到 MCU
   * 协议：55 AA 00 02 00 01 CRC-8/MAXIM
   * @returns {Object} 发送结果
   * @returns {boolean} success - 是否成功发送到 BLE 层（注意：不代表 MCU 一定响应）
   */
  async sendHeartbeat() {
    try {
      const frame = this.commandBuilder.buildHeartbeatCommand();
      const hexString = frame.map((b) => b.toString(16).padStart(2, '0')).join(' ');
      // 记录发送日志
      this.addConnectionLog('send', '发送心跳指令', {
        hex: hexString,
        length: frame.length,
        command: '0x' + frame[2].toString(16),
        data: frame.slice(4, -1).map(b => '0x' + b.toString(16)).join(' '),
        crc: '0x' + frame[frame.length - 1].toString(16)
      });
      const result = await this.sendCommand({ type: 'heartbeat' });
      return result;
    } catch (error) {
      this.addConnectionLog('error', '发送心跳指令失败', { message: error.message });
      return { success: false, message: error.message };
    }
  }

  /**
   * 验证 MCU 是否响应心跳
   * 流程：发送心跳 → 等待 0x80 响应 → 超时则重试 → 仍超时则判定为非目标设备
   * @returns {Promise<boolean>} true=MCU 响应了心跳（确认为目标设备）；false=超时未响应
   */
  verifyDeviceHeartbeat() {
    return new Promise(async (resolve) => {
      // 防止上一次的 resolver 残留
      this.heartbeatResponseResolver = null;
      this.heartbeatResponseRejecter = null;

      let retryCount = 0;
      const maxRetries = 3;
      const retryDelay = 2000; // 每次重试间隔 2 秒
      let timers = [];
      let settled = false;

      const settle = (result) => {
        if (settled) return;
        settled = true;
        // 清理 resolver / rejecter
        this.heartbeatResponseResolver = null;
        this.heartbeatResponseRejecter = null;
        // 清理所有定时器
        timers.forEach(timer => clearTimeout(timer));
        timers = [];
        console.log(`=== 心跳验证结果: ${result ? '成功' : '失败'} ===`);
        resolve(result);
      };

      // 给 BLE 通知订阅一个建立时间（500ms），让原生层把 CCC descriptor 写完
      console.log('等待 BLE 通知订阅建立...');
      await new Promise((r) => setTimeout(r, 500));

      // 等待响应的 resolver，被 subscribeToCharacteristic 的 notify 回调触发
      this.heartbeatResponseResolver = () => {
        console.log('✓ 收到心跳响应！');
        settle(true);
      };
      this.heartbeatResponseRejecter = () => settle(false);

      // 发送心跳命令并处理重试逻辑
      const sendHeartbeatWithRetry = async (attempt) => {
        console.log(`=== 心跳验证：第 ${attempt} 次发送 ===`);
        
        // 设置本次发送的超时定时器
        const timeoutTimer = setTimeout(() => {
          retryCount++;
          if (retryCount < maxRetries) {
            console.warn(`第 ${attempt} 次心跳超时（${retryDelay}ms），准备重试...`);
            // 延迟后重试
            const retryTimer = setTimeout(() => {
              sendHeartbeatWithRetry(retryCount + 1);
            }, 500); // 500ms 间隔后重试
            timers.push(retryTimer);
          } else {
            console.error(
              `心跳响应超时（共 ${retryDelay * maxRetries}ms，重试 ${maxRetries} 次），未收到 0x80 响应`
            );
            settle(false);
          }
        }, retryDelay);
        timers.push(timeoutTimer);

        // 发送心跳命令
        const result = await this.sendHeartbeat();
        if (!result || !result.success) {
          console.error(`第 ${attempt} 次发送心跳命令失败:`, result?.message);
          // 清理本次超时定时器，直接重试
          const idx = timers.indexOf(timeoutTimer);
          if (idx > -1) {
            clearTimeout(timers[idx]);
            timers.splice(idx, 1);
          }
          retryCount++;
          if (retryCount < maxRetries) {
            const retryTimer = setTimeout(() => {
              sendHeartbeatWithRetry(retryCount + 1);
            }, 500);
            timers.push(retryTimer);
          } else {
            settle(false);
          }
        }
      };

      // 开始第一次发送
      await sendHeartbeatWithRetry(1);
    });
  }

  /**
   * 断开与蓝牙设备的连接
   *
   * 【切库/退出前必关灯】在 cancelConnection 之前先尝试发 controlAll: false,
   * 这样即使切库时用户不在 BOM 页(没有 useEffect 监听),
   * 也保证物理上把旧库存的灯灭掉。
   *
   * 优先 fastControlAll (不等 ACK + 1.5s 超时), 失败兜底 sendCommand。
   * 任何一步失败都被 try/catch 抓住, 不阻塞断开主流程。
   * (链路真死了 — 切库本身不受影响, 旧库存的灯只能等用户手动断电)
   */
  async disconnect() {
    try {
      // Web平台不支持蓝牙功能
      if (Platform.OS === 'web') {
        console.log('Web平台不支持蓝牙功能');
        this.connectedDevice = null;
        return;
      }

      // 如果有连接的设备, 断开前先发"全灭"指令
      if (this.connectedDevice) {
        try {
          // 优先用 fastControlAll: 不等 ACK + 1.5s 超时, 不会卡住断开流程
          if (typeof this.fastControlAll === 'function') {
            const r = await this.fastControlAll(false);
            console.log(
              '[BluetoothHandler] 断开前 fastControlAll:',
              r && r.success ? 'OK' : ('FAIL ' + (r && r.reason))
            );
            if (!r || !r.success) {
              // 兜底
              try {
                await this.sendCommand({ type: 'controlAll', state: false });
                console.log('[BluetoothHandler] 断开前已熄灭所有灯 (兜底 sendCommand)');
              } catch (e) {
                console.warn('[BluetoothHandler] 断开前兜底 sendCommand 也失败:', e?.message || e);
              }
            } else {
              console.log('[BluetoothHandler] 断开前已熄灭所有灯 (fastControlAll)');
            }
          } else {
            await this.sendCommand({ type: 'controlAll', state: false });
            console.log('[BluetoothHandler] 断开前已熄灭所有灯 (sendCommand)');
          }
        } catch (e) {
          console.warn(
            '[BluetoothHandler] 断开前灭灯失败 (不阻塞断开, 链路可能已死):',
            e?.message || e
          );
        }
        try {
          await this.connectedDevice.cancelConnection();
          console.log('设备断开连接成功');
        } catch (cancelErr) {
          // 链路本来可能就已经死了, 静默继续
          console.warn('[BluetoothHandler] cancelConnection 失败 (链路可能已死):', cancelErr?.message || cancelErr);
        }
      }
      this.connectedDevice = null;
      // 清除全局连接状态，确保其他页面能正确检测到断开状态
      if (global.deviceConnection && global.deviceConnection.handler === this) {
        delete global.deviceConnection;
        console.log('全局连接状态已清除');
      }
    } catch (error) {
      console.error('断开连接失败:', error);
      this.connectedDevice = null;
      // 清除全局连接状态
      if (global.deviceConnection && global.deviceConnection.handler === this) {
        delete global.deviceConnection;
      }
    }
  }

  /**
   * 获取当前已连接设备的 MAC 地址
   * @returns {string|null} MAC 地址(AA:BB:CC:DD:EE:FF 格式), 未连接返回 null
   */
  getCurrentMac() {
    try {
      if (!this.connectedDevice) return null;
      // ble-plx 中 id 字段就是 MAC
      return this.connectedDevice.id || null;
    } catch (err) {
      console.error('获取当前 MAC 失败:', err);
      return null;
    }
  }

  /**
   * 记录连接日志
   * @param {string} type - 日志类型: 'info', 'success', 'warning', 'error', 'send', 'receive'
   * @param {string} message - 日志消息
   * @param {Object} [details] - 详细信息（如发送/接收的数据）
   */
  addConnectionLog(type, message, details = {}) {
    const timestamp = new Date().toLocaleTimeString();
    this.connectionLog.push({
      timestamp,
      type,
      message,
      details,
    });
    // 保留最近100条日志
    if (this.connectionLog.length > 100) {
      this.connectionLog.shift();
    }
    // 同时输出到控制台
    const prefix = {
      info: '[INFO]',
      success: '[SUCCESS]',
      warning: '[WARNING]',
      error: '[ERROR]',
      send: '[SEND]',
      receive: '[RECEIVE]',
    }[type] || '[INFO]';
    console.log(`${prefix} ${timestamp} - ${message}`, details);
  }

  /**
   * 获取连接日志
   * @returns {Array} 日志数组
   */
  getConnectionLog() {
    return [...this.connectionLog];
  }

  /**
   * 清空连接日志
   */
  clearConnectionLog() {
    this.connectionLog = [];
  }

  /**
   * 将字节数组转换为Base64编码
   * @param {Array<number>} bytes - 要编码的字节数组
   * @returns {string} Base64编码字符串
   */
  bytesToBase64(bytes) {
    // 确保每个字节都在0-255范围内
    const clampedBytes = bytes.map((byte) => byte & 0xff);
    console.log('要编码的字节数组:', clampedBytes);

    try {
      // 使用全局btoa函数进行编码
      let binary = '';
      for (let i = 0; i < clampedBytes.length; i++) {
        binary += String.fromCharCode(clampedBytes[i]);
      }

      const base64 = btoa(binary);
      console.log('Base64编码成功:', base64);
      return base64;
    } catch (error) {
      console.error('Base64编码失败:', error);
      // 如果全局btoa失败，使用自定义实现
      return this.simpleBytesToBase64(clampedBytes);
    }
  }

  /**
   * 简单的Base64编码实现（备用方案）
   * @param {Array<number>} bytes - 要编码的字节数组
   * @returns {string} Base64编码字符串
   */
  simpleBytesToBase64(bytes) {
    const base64Chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    let i = 0;
    const len = bytes.length;

    while (i < len) {
      // 每次处理3个字节
      const byte1 = bytes[i] & 0xff;
      const byte2 = i + 1 < len ? bytes[i + 1] & 0xff : 0;
      const byte3 = i + 2 < len ? bytes[i + 2] & 0xff : 0;

      // 将3个字节编码为4个Base64字符
      const enc1 = byte1 >> 2;
      const enc2 = ((byte1 & 0x03) << 4) | (byte2 >> 4);
      const enc3 = ((byte2 & 0x0f) << 2) | (byte3 >> 6);
      const enc4 = byte3 & 0x3f;

      result += base64Chars[enc1];
      result += base64Chars[enc2];

      // 根据剩余字节数添加填充
      const remaining = len - i;
      if (remaining >= 2) {
        result += base64Chars[enc3];
      } else {
        result += '=';
      }

      if (remaining >= 3) {
        result += base64Chars[enc4];
      } else {
        result += '=';
      }

      i += 3;
    }

    console.log('简单Base64编码成功:', result);
    return result;
  }

  /**
   * 将Base64编码字符串转换为字节数组
   * @param {string} base64 - Base64编码字符串
   * @returns {Uint8Array} 字节数组
   */
  base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

export default BluetoothHandler;
