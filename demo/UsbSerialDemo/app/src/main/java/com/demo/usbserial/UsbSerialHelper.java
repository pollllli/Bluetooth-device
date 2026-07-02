package com.demo.usbserial;

import android.app.PendingIntent;
import android.content.Context;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.util.Log;

import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.driver.UsbSerialProber;

import java.io.IOException;
import java.util.List;

/**
 * USB串口管理器
 * 使用 usb-serial-for-android 库实现USB串口通信
 * 支持CH340/CP2102/FTDI/PL2303等常见USB转串口芯片
 */
public class UsbSerialHelper {
    private static final String TAG = "UsbSerialHelper";
    public static final String ACTION_USB_PERMISSION = "com.demo.usbserial.USB_PERMISSION";

    private final Context context;
    private final UsbManager usbManager;
    private UsbSerialPort serialPort;
    private UsbDeviceConnection connection;
    private boolean isConnected = false;

    private OnDataReceivedListener dataListener;
    private OnConnectionListener connectionListener;
    private Thread readThread;
    private volatile boolean reading = false;

    public interface OnDataReceivedListener {
        void onDataReceived(byte[] data);
    }

    public interface OnConnectionListener {
        void onConnected(String deviceName);
        void onDisconnected();
        void onError(String message);
    }

    public UsbSerialHelper(Context context) {
        this.context = context;
        this.usbManager = (UsbManager) context.getSystemService(Context.USB_SERVICE);
    }

    public void setOnDataReceivedListener(OnDataReceivedListener listener) {
        this.dataListener = listener;
    }

    public void setOnConnectionListener(OnConnectionListener listener) {
        this.connectionListener = listener;
    }

    /**
     * 查找可用的USB串口设备
     */
    public UsbSerialDriver findSerialDevice() {
        List<UsbSerialDriver> drivers = UsbSerialProber.getDefaultProber().findAllDrivers(usbManager);
        if (drivers.isEmpty()) {
            return null;
        }
        return drivers.get(0);
    }

    /**
     * 请求USB设备权限
     */
    public void requestPermission(UsbSerialDriver driver) {
        if (driver == null) return;
        UsbDevice device = driver.getDevice();
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context, 0,
                new android.content.Intent(ACTION_USB_PERMISSION),
                PendingIntent.FLAG_IMMUTABLE
        );
        usbManager.requestPermission(device, pendingIntent);
    }

    /**
     * 检查是否有权限
     */
    public boolean hasPermission(UsbSerialDriver driver) {
        if (driver == null) return false;
        return usbManager.hasPermission(driver.getDevice());
    }

    /**
     * 连接USB串口
     */
    public boolean connect(UsbSerialDriver driver, int baudRate) {
        if (driver == null) {
            if (connectionListener != null) connectionListener.onError("未找到串口设备");
            return false;
        }

        UsbDevice device = driver.getDevice();
        if (!usbManager.hasPermission(device)) {
            if (connectionListener != null) connectionListener.onError("没有USB设备权限");
            return false;
        }

        try {
            connection = usbManager.openDevice(device);
            if (connection == null) {
                if (connectionListener != null) connectionListener.onError("无法打开USB设备");
                return false;
            }

            serialPort = driver.getPorts().get(0);
            serialPort.open(connection);
            serialPort.setParameters(baudRate, UsbSerialPort.DATABITS_8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
            serialPort.setDTR(true);
            serialPort.setRTS(true);

            isConnected = true;
            startReading();

            String deviceName = device.getDeviceName();
            if (connectionListener != null) connectionListener.onConnected(deviceName);
            return true;

        } catch (IOException e) {
            Log.e(TAG, "连接失败", e);
            disconnect();
            if (connectionListener != null) connectionListener.onError("连接失败: " + e.getMessage());
            return false;
        }
    }

    /**
     * 断开连接
     */
    public void disconnect() {
        reading = false;
        isConnected = false;

        if (readThread != null) {
            readThread.interrupt();
            readThread = null;
        }

        if (serialPort != null) {
            try {
                serialPort.close();
            } catch (IOException e) {
                Log.e(TAG, "关闭串口失败", e);
            }
            serialPort = null;
        }

        if (connection != null) {
            connection.close();
            connection = null;
        }

        if (connectionListener != null) connectionListener.onDisconnected();
    }

    /**
     * 发送数据
     */
    public boolean send(byte[] data) {
        if (!isConnected || serialPort == null) return false;
        try {
            serialPort.write(data, 1000);
            return true;
        } catch (IOException e) {
            Log.e(TAG, "发送失败", e);
            return false;
        }
    }

    /**
     * 开始读取数据
     */
    private void startReading() {
        reading = true;
        readThread = new Thread(() -> {
            byte[] buffer = new byte[256];
            while (reading && serialPort != null) {
                try {
                    int len = serialPort.read(buffer, 100);
                    if (len > 0 && dataListener != null) {
                        byte[] data = new byte[len];
                        System.arraycopy(buffer, 0, data, 0, len);
                        dataListener.onDataReceived(data);
                    }
                } catch (IOException e) {
                    if (reading) {
                        Log.e(TAG, "读取失败", e);
                        reading = false;
                        isConnected = false;
                        if (connectionListener != null) connectionListener.onError("连接断开: " + e.getMessage());
                    }
                }
            }
        });
        readThread.start();
    }

    public boolean isConnected() {
        return isConnected;
    }
}
