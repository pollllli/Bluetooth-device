package com.demo.usbserial;

/**
 * 串口通信协议实现
 *
 * 协议帧格式:
 * 帧头(0x55) + 帧头(0xAA) + 命令字(1字节) + 数据长度(1字节) + 数据(uint16_t数组) + CRC-8/MAXIM(1字节)
 *
 * 数据长度: 数据的总字节数（一个数据是2字节）
 * 数据: 每个数据2字节，高位在前，低位在后。最多8个数据(8*2=16字节)
 * CRC-8/MAXIM: 多项式 x8+x5+x4+1, 初始值0x00
 */
public class Protocol {

    // 命令字定义
    public static final int CMD_HEARTBEAT  = 0x00; // 心跳
    public static final int CMD_LIGHT_ON   = 0x01; // 点亮对应灯
    public static final int CMD_LIGHT_OFF  = 0x02; // 熄灭对应灯
    public static final int CMD_LIGHT_ALL  = 0x03; // 点亮/熄灭所有灯

    // MCU响应命令字 (CMD | 0x80)
    public static final int CMD_RESP_HEARTBEAT = 0x80;
    public static final int CMD_RESP_LIGHT_ON  = 0x81;
    public static final int CMD_RESP_LIGHT_OFF = 0x82;
    public static final int CMD_RESP_LIGHT_ALL = 0x83;

    // 全部灯控制数据
    public static final int DATA_ALL_ON  = 0xFFFF;
    public static final int DATA_ALL_OFF = 0x0000;

    /**
     * CRC-8/MAXIM 校验
     * 多项式: x8+x5+x4+1, 反射多项式: 0x8C
     */
    public static byte crc8Maxim(byte[] data, int length) {
        int crc = 0x00;
        for (int i = 0; i < length; i++) {
            crc ^= (data[i] & 0xFF);
            for (int j = 0; j < 8; j++) {
                if ((crc & 0x01) != 0) {
                    crc = (crc >> 1) ^ 0x8C;
                } else {
                    crc >>= 1;
                }
            }
        }
        return (byte) crc;
    }

    /**
     * 构建协议帧
     * @param cmd  命令字
     * @param data uint16数据数组
     * @return 完整的协议帧字节数组
     */
    public static byte[] buildFrame(int cmd, int[] data) {
        // 数据转为字节数组，高位在前低位在后
        int dataLen = data.length * 2;
        byte[] frame = new byte[4 + dataLen + 1]; // 帧头2+命令1+长度1+数据+CRC1

        frame[0] = 0x55;       // 帧头
        frame[1] = (byte) 0xAA; // 帧头
        frame[2] = (byte) cmd;  // 命令字
        frame[3] = (byte) dataLen; // 数据长度（字节数）

        // 填充数据，高位在前低位在后
        for (int i = 0; i < data.length; i++) {
            frame[4 + i * 2]     = (byte) ((data[i] >> 8) & 0xFF); // 高位
            frame[4 + i * 2 + 1] = (byte) (data[i] & 0xFF);       // 低位
        }

        // CRC校验（从帧头到数据最后一位）
        frame[4 + dataLen] = crc8Maxim(frame, 4 + dataLen);

        return frame;
    }

    /**
     * 构建心跳帧
     */
    public static byte[] buildHeartbeat() {
        return buildFrame(CMD_HEARTBEAT, new int[]{0x0001});
    }

    /**
     * 构建点亮指定灯帧
     * @param position 灯位置
     */
    public static byte[] buildLightOn(int position) {
        return buildFrame(CMD_LIGHT_ON, new int[]{position});
    }

    /**
     * 构建熄灭指定灯帧
     * @param position 灯位置
     */
    public static byte[] buildLightOff(int position) {
        return buildFrame(CMD_LIGHT_OFF, new int[]{position});
    }

    /**
     * 构建点亮所有灯帧
     */
    public static byte[] buildLightAllOn() {
        return buildFrame(CMD_LIGHT_ALL, new int[]{DATA_ALL_ON});
    }

    /**
     * 构建熄灭所有灯帧
     */
    public static byte[] buildLightAllOff() {
        return buildFrame(CMD_LIGHT_ALL, new int[]{DATA_ALL_OFF});
    }

    /**
     * 解析协议帧
     * @param buffer 接收缓冲区
     * @param length 有效数据长度
     * @return 解析结果，null表示数据不完整或校验失败
     */
    public static FrameInfo parseFrame(byte[] buffer, int length) {
        // 查找帧头
        int start = -1;
        for (int i = 0; i < length - 1; i++) {
            if ((buffer[i] & 0xFF) == 0x55 && (buffer[i + 1] & 0xFF) == 0xAA) {
                start = i;
                break;
            }
        }
        if (start == -1) return null;

        // 检查最小帧长度
        if (length - start < 5) return null;

        int cmd = buffer[start + 2] & 0xFF;
        int dataLen = buffer[start + 3] & 0xFF;
        int frameLen = 4 + dataLen + 1;

        // 检查帧是否完整
        if (length - start < frameLen) return null;

        // CRC校验
        byte crcCalc = crc8Maxim(buffer, start, 4 + dataLen);
        byte crcRecv = buffer[start + 4 + dataLen];
        if (crcCalc != crcRecv) {
            return new FrameInfo(cmd, new int[0], true); // CRC错误
        }

        // 解析数据
        int[] data = new int[dataLen / 2];
        for (int i = 0; i < data.length; i++) {
            int high = buffer[start + 4 + i * 2] & 0xFF;
            int low  = buffer[start + 4 + i * 2 + 1] & 0xFF;
            data[i] = (high << 8) | low;
        }

        return new FrameInfo(cmd, data, false);
    }

    /**
     * CRC校验（带偏移）
     */
    public static byte crc8Maxim(byte[] data, int offset, int length) {
        int crc = 0x00;
        for (int i = offset; i < offset + length; i++) {
            crc ^= (data[i] & 0xFF);
            for (int j = 0; j < 8; j++) {
                if ((crc & 0x01) != 0) {
                    crc = (crc >> 1) ^ 0x8C;
                } else {
                    crc >>= 1;
                }
            }
        }
        return (byte) crc;
    }

    /**
     * 字节数组转十六进制字符串
     */
    public static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02X ", b & 0xFF));
        }
        return sb.toString().trim();
    }

    /**
     * 获取命令名称
     */
    public static String getCmdName(int cmd) {
        switch (cmd) {
            case CMD_HEARTBEAT:      return "心跳";
            case CMD_LIGHT_ON:       return "点亮灯";
            case CMD_LIGHT_OFF:      return "熄灭灯";
            case CMD_LIGHT_ALL:      return "全部灯";
            case CMD_RESP_HEARTBEAT: return "心跳响应";
            case CMD_RESP_LIGHT_ON:  return "点亮灯响应";
            case CMD_RESP_LIGHT_OFF: return "熄灭灯响应";
            case CMD_RESP_LIGHT_ALL: return "全部灯响应";
            default:                 return String.format("未知(0x%02X)", cmd);
        }
    }

    /**
     * 帧信息类
     */
    public static class FrameInfo {
        public int cmd;
        public int[] data;
        public boolean crcError;
        public int frameLength; // 帧总长度（用于从缓冲区移除已解析的数据）

        public FrameInfo(int cmd, int[] data, boolean crcError) {
            this.cmd = cmd;
            this.data = data;
            this.crcError = crcError;
            this.frameLength = 4 + data.length * 2 + 1;
        }
    }
}
