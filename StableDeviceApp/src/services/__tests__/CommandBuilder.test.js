import CommandBuilder, { COMMANDS } from '../CommandBuilder';

describe('CommandBuilder', () => {
  let builder;

  beforeEach(() => {
    builder = new CommandBuilder();
  });

  describe('CRC8计算', () => {
    test('应该正确计算CRC8校验值', () => {
      const data = [0x55, 0xaa, 0x01, 0x02, 0x00, 0x01];
      const crc = builder.calculateCRC8(data);
      
      expect(typeof crc).toBe('number');
      expect(crc).toBeGreaterThanOrEqual(0);
      expect(crc).toBeLessThan(256);
    });

    test('空数据应该返回初始值0', () => {
      const crc = builder.calculateCRC8([]);
      expect(crc).toBe(0);
    });
  });

  describe('帧验证', () => {
    test('有效帧应该返回true', () => {
      const frame = builder.buildLightOnCommand(1);
      const isValid = builder.isValidFrame(frame);
      
      expect(isValid).toBe(true);
    });

    test('无效帧头应该返回false', () => {
      const frame = [0x00, 0xaa, 0x01, 0x02, 0x00, 0x01, 0x00];
      const isValid = builder.isValidFrame(frame);
      
      expect(isValid).toBe(false);
    });

    test('无效CRC应该返回false', () => {
      const frame = [0x55, 0xaa, 0x01, 0x02, 0x00, 0x01, 0x00];
      const isValid = builder.isValidFrame(frame);
      
      expect(isValid).toBe(false);
    });

    test('长度不足的帧应该返回false', () => {
      const frame = [0x55, 0xaa];
      const isValid = builder.isValidFrame(frame);
      
      expect(isValid).toBe(false);
    });
  });

  describe('命令帧构建', () => {
    test('构建心跳命令帧应该正确', () => {
      const frame = builder.buildHeartbeatCommand();
      
      expect(frame.length).toBeGreaterThanOrEqual(6);
      expect(frame[0]).toBe(0x55);
      expect(frame[1]).toBe(0xaa);
      expect(frame[2]).toBe(COMMANDS.HEARTBEAT);
      expect(frame[3]).toBe(2);
      expect(frame[4]).toBe(0x00);
      expect(frame[5]).toBe(0x01);
      
      expect(builder.isValidFrame(frame)).toBe(true);
    });

    test('构建点亮灯命令帧应该正确', () => {
      const frame = builder.buildLightOnCommand(1);
      
      expect(frame.length).toBeGreaterThanOrEqual(6);
      expect(frame[0]).toBe(0x55);
      expect(frame[1]).toBe(0xaa);
      expect(frame[2]).toBe(COMMANDS.LIGHT_ON);
      expect(frame[3]).toBe(2);
      expect(frame[4]).toBe(0x00);
      expect(frame[5]).toBe(0x01);
      
      expect(builder.isValidFrame(frame)).toBe(true);
    });

    test('构建熄灭灯命令帧应该正确', () => {
      const frame = builder.buildLightOffCommand(1);
      
      expect(frame.length).toBeGreaterThanOrEqual(6);
      expect(frame[0]).toBe(0x55);
      expect(frame[1]).toBe(0xaa);
      expect(frame[2]).toBe(COMMANDS.LIGHT_OFF);
      expect(frame[3]).toBe(2);
      expect(frame[4]).toBe(0x00);
      expect(frame[5]).toBe(0x01);
      
      expect(builder.isValidFrame(frame)).toBe(true);
    });

    test('构建控制所有灯命令帧（点亮）应该正确', () => {
      const frame = builder.buildControlAllLightsCommand(true);
      
      expect(frame.length).toBeGreaterThanOrEqual(6);
      expect(frame[0]).toBe(0x55);
      expect(frame[1]).toBe(0xaa);
      expect(frame[2]).toBe(COMMANDS.CONTROL_ALL_LIGHTS);
      expect(frame[3]).toBe(2);
      expect(frame[4]).toBe(0xff);
      expect(frame[5]).toBe(0xff);
      
      expect(builder.isValidFrame(frame)).toBe(true);
    });

    test('构建控制所有灯命令帧（熄灭）应该正确', () => {
      const frame = builder.buildControlAllLightsCommand(false);
      
      expect(frame.length).toBeGreaterThanOrEqual(6);
      expect(frame[0]).toBe(0x55);
      expect(frame[1]).toBe(0xaa);
      expect(frame[2]).toBe(COMMANDS.CONTROL_ALL_LIGHTS);
      expect(frame[3]).toBe(2);
      expect(frame[4]).toBe(0x00);
      expect(frame[5]).toBe(0x00);
      
      expect(builder.isValidFrame(frame)).toBe(true);
    });

    test('高位灯ID应该正确拆分', () => {
      const frame = builder.buildLightOnCommand(257);
      
      expect(frame[4]).toBe(0x01);
      expect(frame[5]).toBe(0x01);
    });
  });

  describe('响应解析', () => {
    test('应该能够解析有效的响应帧', () => {
      const response = [0x55, 0xaa, COMMANDS.RESPONSE_HEARTBEAT, 2, 0x00, 0x01, 0x00];
      const crc = builder.calculateCRC8(response.slice(0, -1));
      response[response.length - 1] = crc;
      
      const parsed = builder.parseResponse(response);
      
      expect(parsed).not.toBeNull();
      expect(parsed.command).toBe(COMMANDS.RESPONSE_HEARTBEAT);
      expect(parsed.length).toBe(2);
      expect(parsed.isValid).toBe(true);
    });

    test('无效的响应帧应该返回null', () => {
      const invalidFrame = [0x00, 0x00, 0x01, 0x02, 0x00, 0x01, 0x00];
      const parsed = builder.parseResponse(invalidFrame);
      
      expect(parsed).toBeNull();
    });

    test('CRC错误的响应帧应该返回null', () => {
      const response = builder.buildHeartbeatCommand();
      response[response.length - 1] = 0x00;
      
      const parsed = builder.parseResponse(response);
      
      expect(parsed).toBeNull();
    });
  });

  describe('命令名称获取', () => {
    test('应该能够获取已知命令的名称', () => {
      expect(builder.getCommandName(COMMANDS.HEARTBEAT)).toBe('HEARTBEAT');
      expect(builder.getCommandName(COMMANDS.LIGHT_ON)).toBe('LIGHT_ON');
      expect(builder.getCommandName(COMMANDS.RESPONSE_HEARTBEAT)).toBe('RESPONSE_HEARTBEAT');
    });

    test('未知命令应该返回UNKNOWN', () => {
      expect(builder.getCommandName(0xff)).toBe('UNKNOWN');
    });
  });
});