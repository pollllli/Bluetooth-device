/**
 * 命令帧构建器模块
 * 实现串口通信协议帧的构建和解析
 * 协议格式：帧头(2字节) + 命令字(1字节) + 数据长度(1字节) + 数据(N字节) + CRC-8校验(1字节)
 */
/* eslint-disable prettier/prettier */

/**
 * 帧头定义
 * 帧格式：55 AA CMD LEN DATA... CRC
 */
const FRAME_HEADER_1 = 0x55; // 帧头第一字节
const FRAME_HEADER_2 = 0xaa; // 帧头第二字节
const FRAME_MIN_LENGTH = 6; // 最小帧长度（不含数据时：帧头2 + 命令1 + 长度1 + CRC1 = 5？不对，实际最小是6，因为数据至少2字节）

/**
 * 命令字定义
 * MCU响应时命令字 = 原命令字 | 0x80
 */
const COMMANDS = {
  HEARTBEAT: 0x00, // 心跳命令
  LIGHT_ON: 0x01, // 点亮对应灯
  LIGHT_OFF: 0x02, // 熄灭对应灯
  CONTROL_ALL_LIGHTS: 0x03, // 控制所有灯
  RESPONSE_HEARTBEAT: 0x80, // 心跳响应 (0x00 | 0x80)
  RESPONSE_LIGHT_ON: 0x81, // 点亮响应 (0x01 | 0x80)
  RESPONSE_LIGHT_OFF: 0x82, // 熄灭响应 (0x02 | 0x80)
  RESPONSE_CONTROL_ALL: 0x83, // 控制所有灯响应 (0x03 | 0x80)
};

/**
 * 反转字节（位顺序反转）
 * @param {number} byte - 要反转的字节 (0-255)
 * @returns {number} 反转后的字节
 */
function reverseByte(byte) {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    // 逐位提取并反转
    result = (result << 1) | ((byte >> i) & 0x01);
  }
  return result;
}

/**
 * 生成CRC-8/MAXIM校验表
 * 多项式：x^8 + x^5 + x^4 + 1 = 0x31
 * 初始值：0x00
 * 输入/输出反转：是
 * @returns {Uint8Array} CRC校验表（256个元素）
 */
function generateCRCTable() {
  const table = new Uint8Array(256);
  const polynomial = 0x31; // CRC-8/MAXIM 多项式

  for (let i = 0; i < 256; i++) {
    let crc = reverseByte(i); // 输入反转
    for (let j = 0; j < 8; j++) {
      // CRC计算核心逻辑
      crc = (crc << 1) ^ (crc & 0x80 ? polynomial : 0);
    }
    table[i] = reverseByte(crc & 0xff); // 输出反转
  }
  return table;
}

// 预计算CRC表（启动时计算一次，提高运行时效率）
const CRCTable = generateCRCTable();

/**
 * 命令帧构建器类
 * 负责构建和解析串口通信协议帧
 */
class CommandBuilder {
  /**
   * 构造函数
   */
  constructor() {
    this.header1 = FRAME_HEADER_1;
    this.header2 = FRAME_HEADER_2;
    this.crcTable = CRCTable;
  }

  /**
   * 计算CRC-8/MAXIM校验值
   * @param {Array<number>} data - 要计算校验的数据数组
   * @returns {number} CRC-8校验值 (0-255)
   */
  calculateCRC8(data) {
    let crc = 0x00;
    for (let i = 0; i < data.length; i++) {
      // 使用查表法计算CRC
      crc = this.crcTable[crc ^ data[i]];
    }
    return crc;
  }

  /**
   * 构建完整的命令帧
   * @param {number} command - 命令字
   * @param {Array<number>} [data=[]] - 数据字节数组（每个数据为uint16，拆分为两个字节）
   * @returns {Array<number>} 完整的命令帧数组
   */
  buildFrame(command, data = []) {
    const length = data.length;
    // 帧结构：[帧头1, 帧头2, 命令字, 数据长度, ...数据, CRC]
    const frame = [this.header1, this.header2, command, length, ...data];
    const crc = this.calculateCRC8(frame);
    frame.push(crc);
    return frame;
  }

  /**
   * 构建心跳命令帧
   * 数据固定为 0x0001
   * @returns {Array<number>} 心跳命令帧
   */
  buildHeartbeatCommand() {
    const highByte = 0x00;
    const lowByte = 0x01;
    const data = [highByte, lowByte];
    const frame = this.buildFrame(COMMANDS.HEARTBEAT, data);
    return frame;
  }

  /**
   * 构建点亮灯命令帧
   * @param {number} lightId - 灯的ID（位置）
   * @returns {Array<number>} 点亮灯命令帧
   */
  buildLightOnCommand(lightId) {
    // 将lightId拆分为高字节和低字节（大端序）
    const highByte = (lightId >> 8) & 0xff;
    const lowByte = lightId & 0xff;
    const data = [highByte, lowByte];
    const frame = this.buildFrame(COMMANDS.LIGHT_ON, data);
    return frame;
  }

  /**
   * 构建熄灭灯命令帧
   * @param {number} lightId - 灯的ID（位置）
   * @returns {Array<number>} 熄灭灯命令帧
   */
  buildLightOffCommand(lightId) {
    // 将lightId拆分为高字节和低字节（大端序）
    const highByte = (lightId >> 8) & 0xff;
    const lowByte = lightId & 0xff;
    const data = [highByte, lowByte];
    const frame = this.buildFrame(COMMANDS.LIGHT_OFF, data);
    return frame;
  }

  /**
   * 构建控制所有灯命令帧
   * @param {boolean} state - 状态（true=点亮所有，false=熄灭所有）
   * @returns {Array<number>} 控制所有灯命令帧
   */
  buildControlAllLightsCommand(state) {
    // 0xFFFF = 点亮所有灯，0x0000 = 熄灭所有灯
    const value = state ? 0xffff : 0x0000;
    const highByte = (value >> 8) & 0xff;
    const lowByte = value & 0xff;
    const data = [highByte, lowByte];
    const frame = this.buildFrame(COMMANDS.CONTROL_ALL_LIGHTS, data);
    return frame;
  }

  /**
   * 解析MCU响应帧
   * @param {Array<number>} response - 接收到的响应帧
   * @returns {Object|null} 解析结果对象，失败返回null
   * @returns {number} command - 命令字
   * @returns {number} length - 数据长度
   * @returns {Array<number>} data - 数据数组
   * @returns {boolean} isValid - 是否有效
   */
  parseResponse(response) {
    // 检查帧长度
    if (!response || response.length < FRAME_MIN_LENGTH) {
      return null;
    }

    // 检查帧头
    if (response[0] !== this.header1 || response[1] !== this.header2) {
      return null;
    }

    // 检查CRC校验
    const crc = this.calculateCRC8(response.slice(0, -1));
    if (crc !== response[response.length - 1]) {
      return null;
    }

    // 解析命令字和数据长度
    const command = response[2];
    const length = response[3];

    // 验证数据长度是否合理
    if (4 + length > response.length - 1) {
      return null;
    }

    // 提取数据部分
    const data = response.slice(4, 4 + length);

    return {
      command: command,
      length: length,
      data: data,
      isValid: true,
    };
  }

  /**
   * 验证帧是否有效
   * @param {Array<number>} frame - 要验证的帧
   * @returns {boolean} 是否有效
   */
  isValidFrame(frame) {
    // 检查帧长度
    if (!frame || frame.length < FRAME_MIN_LENGTH) {
      return false;
    }

    // 检查帧头
    if (frame[0] !== this.header1 || frame[1] !== this.header2) {
      return false;
    }

    // 检查CRC校验
    const crc = this.calculateCRC8(frame.slice(0, -1));
    return crc === frame[frame.length - 1];
  }

  /**
   * 根据命令字获取命令名称
   * @param {number} command - 命令字
   * @returns {string} 命令名称
   */
  getCommandName(command) {
    for (const [name, value] of Object.entries(COMMANDS)) {
      if (value === command) {
        return name;
      }
    }
    return 'UNKNOWN';
  }
}

export default CommandBuilder;
export { COMMANDS };
