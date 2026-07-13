# 器件管理系统 (Bluetooth-device)

仓库主项目位于 **[StableDeviceApp/](StableDeviceApp/)** 目录,使用 **React Native + Expo** 开发的 Android 移动应用,用于管理电子器件库存与 BOM 配单,通过蓝牙与下位机通信控制器件架指示灯。

完整文档请阅读 [StableDeviceApp/README.md](StableDeviceApp/README.md)。

## 仓库结构

```
Bluetooth-device/
├── StableDeviceApp/     ← 主项目 (React Native + Expo)
│   ├── src/             # 源码 (screens / services / utils)
│   ├── android/         # Android 原生工程
│   ├── README.md        # 完整项目说明 (含功能/安装/协议/FAQ)
│   ├── API.md           # 完整 API 文档 (v1.2.3)
│   ├── PROTOCOL.md      # 蓝牙通信协议
│   └── ...
├── crawler_server.py    # 辅助工具 (独立 Python 爬虫, 跟 app 无关)
└── README.md            # 本文件
```

## 快速开始

- 完整安装与构建步骤: [StableDeviceApp/README.md#安装步骤](StableDeviceApp/README.md#安装步骤)
- 通信协议: [PROTOCOL.md](StableDeviceApp/PROTOCOL.md)
- API 文档: [API.md](StableDeviceApp/API.md)

## 当前版本

**v1.2.3** (2026-07-07) — 多库存管理 / BOM 配单 / 蓝牙扫描过滤 / 灯状态集中管理
