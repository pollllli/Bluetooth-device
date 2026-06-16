// CRC-8/MAXIM 验证脚本
// 标准校验值："123456789" 应该算出 0xA1

function reverseByte(byte) {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    result = (result << 1) | ((byte >> i) & 0x01);
  }
  return result;
}

function generateCRCTable() {
  const table = new Uint8Array(256);
  const polynomial = 0x31;
  for (let i = 0; i < 256; i++) {
    let crc = reverseByte(i);
    for (let j = 0; j < 8; j++) {
      crc = (crc << 1) ^ (crc & 0x80 ? polynomial : 0);
    }
    table[i] = reverseByte(crc & 0xff);
  }
  return table;
}

const CRCTable = generateCRCTable();

function calculateCRC8(data) {
  let crc = 0x00;
  for (let i = 0; i < data.length; i++) {
    crc = CRCTable[crc ^ data[i]];
  }
  return crc;
}

// 测试 1：标准校验
const test = [0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39];
const crc1 = calculateCRC8(test);
console.log(`"123456789" CRC: 0x${crc1.toString(16).padStart(2,'0')} (期望 0xa1)`);
console.log(crc1 === 0xa1 ? '✓ CRC 实现正确' : '✗ CRC 实现错误！');

// 测试 2：心跳帧
const heartbeat = [0x55, 0xAA, 0x00, 0x02, 0x00, 0x01];
const crc2 = calculateCRC8(heartbeat);
console.log(`\n心跳帧 55 AA 00 02 00 01 CRC: 0x${crc2.toString(16).padStart(2,'0')}`);
console.log(`完整心跳帧: 55 AA 00 02 00 01 ${crc2.toString(16).padStart(2,'0')}`);

// 测试 3：响应帧
const response = [0x55, 0xAA, 0x80, 0x02, 0x00, 0x01];
const crc3 = calculateCRC8(response);
console.log(`\n响应帧 55 AA 80 02 00 01 CRC: 0x${crc3.toString(16).padStart(2,'0')}`);
console.log(`完整响应帧: 55 AA 80 02 00 01 ${crc3.toString(16).padStart(2,'0')}`);

// 测试 4：其他命令
console.log(`\n点灯 0x0001  CRC: ${calculateCRC8([0x55,0xAA,0x01,0x02,0x00,0x01]).toString(16).padStart(2,'0')}`);
console.log(`熄灯 0x0001  CRC: ${calculateCRC8([0x55,0xAA,0x02,0x02,0x00,0x01]).toString(16).padStart(2,'0')}`);
console.log(`全开 0xFFFF  CRC: ${calculateCRC8([0x55,0xAA,0x03,0x02,0xFF,0xFF]).toString(16).padStart(2,'0')}`);
console.log(`全关 0x0000  CRC: ${calculateCRC8([0x55,0xAA,0x03,0x02,0x00,0x00]).toString(16).padStart(2,'0')}`);
