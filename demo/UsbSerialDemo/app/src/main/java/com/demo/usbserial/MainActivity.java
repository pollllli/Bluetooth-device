package com.demo.usbserial;

import androidx.appcompat.app.AppCompatActivity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.method.ScrollingMovementMethod;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import com.hoho.android.usbserial.driver.UsbSerialDriver;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 主界面 - USB串口通信Demo
 */
public class MainActivity extends AppCompatActivity {

    private UsbSerialHelper serialHelper;
    private UsbSerialDriver currentDriver;
    private Handler handler = new Handler(Looper.getMainLooper());
    private SimpleDateFormat timeFormat = new SimpleDateFormat("HH:mm:ss.SSS", Locale.getDefault());

    // UI组件
    private Button btnConnect;
    private Button btnDisconnect;
    private Spinner spinnerBaudRate;
    private TextView tvStatus;
    private View statusDot;
    private EditText etPosition;
    private Button btnLightOn;
    private Button btnLightOff;
    private Button btnLightAllOn;
    private Button btnLightAllOff;
    private TextView tvLog;
    private ScrollView scrollLog;
    private Button btnClearLog;

    // 接收缓冲区
    private byte[] recvBuffer = new byte[256];
    private int recvBufferLen = 0;

    private final BroadcastReceiver usbPermissionReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (UsbSerialHelper.ACTION_USB_PERMISSION.equals(action)) {
                boolean granted = intent.getBooleanExtra(android.hardware.usb.UsbManager.EXTRA_PERMISSION_GRANTED, false);
                if (granted && currentDriver != null) {
                    int baudRate = Integer.parseInt(spinnerBaudRate.getSelectedItem().toString());
                    serialHelper.connect(currentDriver, baudRate);
                } else {
                    appendLog("USB权限被拒绝", "error");
                }
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // 初始化USB串口管理器
        serialHelper = new UsbSerialHelper(this);
        serialHelper.setOnDataReceivedListener(this::onDataReceived);
        serialHelper.setOnConnectionListener(new UsbSerialHelper.OnConnectionListener() {
            @Override
            public void onConnected(String deviceName) {
                handler.post(() -> {
                    updateUI(true);
                    appendLog("已连接: " + deviceName, "info");
                });
            }

            @Override
            public void onDisconnected() {
                handler.post(() -> {
                    updateUI(false);
                    appendLog("已断开连接", "info");
                });
            }

            @Override
            public void onError(String message) {
                handler.post(() -> {
                    updateUI(false);
                    appendLog("错误: " + message, "error");
                });
            }
        });

        initViews();
        registerUsbReceiver();
    }

    private void initViews() {
        btnConnect = findViewById(R.id.btn_connect);
        btnDisconnect = findViewById(R.id.btn_disconnect);
        spinnerBaudRate = findViewById(R.id.spinner_baud_rate);
        tvStatus = findViewById(R.id.tv_status);
        statusDot = findViewById(R.id.status_dot);
        etPosition = findViewById(R.id.et_position);
        btnLightOn = findViewById(R.id.btn_light_on);
        btnLightOff = findViewById(R.id.btn_light_off);
        btnLightAllOn = findViewById(R.id.btn_light_all_on);
        btnLightAllOff = findViewById(R.id.btn_light_all_off);
        tvLog = findViewById(R.id.tv_log);
        scrollLog = findViewById(R.id.scroll_log);
        btnClearLog = findViewById(R.id.btn_clear_log);

        // 波特率选项
        String[] baudRates = {"9600", "19200", "38400", "57600", "115200", "230400", "460800", "921600"};
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, baudRates);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinnerBaudRate.setAdapter(adapter);
        spinnerBaudRate.setSelection(4); // 默认115200

        // 连接按钮
        btnConnect.setOnClickListener(v -> handleConnect());
        btnDisconnect.setOnClickListener(v -> handleDisconnect());

        // 灯光控制
        btnLightOn.setOnClickListener(v -> handleLightOn());
        btnLightOff.setOnClickListener(v -> handleLightOff());
        btnLightAllOn.setOnClickListener(v -> handleLightAllOn());
        btnLightAllOff.setOnClickListener(v -> handleLightAllOff());

        // 清空日志
        btnClearLog.setOnClickListener(v -> tvLog.setText(""));

        updateUI(false);
    }

    private void registerUsbReceiver() {
        IntentFilter filter = new IntentFilter(UsbSerialHelper.ACTION_USB_PERMISSION);
        registerReceiver(usbPermissionReceiver, filter);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        serialHelper.disconnect();
        unregisterReceiver(usbPermissionReceiver);
    }

    private void handleConnect() {
        currentDriver = serialHelper.findSerialDevice();
        if (currentDriver == null) {
            appendLog("未找到USB串口设备，请检查连接", "error");
            Toast.makeText(this, "未找到USB串口设备", Toast.LENGTH_SHORT).show();
            return;
        }

        if (serialHelper.hasPermission(currentDriver)) {
            int baudRate = Integer.parseInt(spinnerBaudRate.getSelectedItem().toString());
            serialHelper.connect(currentDriver, baudRate);
        } else {
            appendLog("请求USB设备权限...", "info");
            serialHelper.requestPermission(currentDriver);
        }
    }

    private void handleDisconnect() {
        serialHelper.disconnect();
    }

    private void handleLightOn() {
        int pos = getPosition();
        if (pos < 0) return;
        byte[] frame = Protocol.buildLightOn(pos);
        sendFrame(frame);
    }

    private void handleLightOff() {
        int pos = getPosition();
        if (pos < 0) return;
        byte[] frame = Protocol.buildLightOff(pos);
        sendFrame(frame);
    }

    private void handleLightAllOn() {
        byte[] frame = Protocol.buildLightAllOn();
        sendFrame(frame);
    }

    private void handleLightAllOff() {
        byte[] frame = Protocol.buildLightAllOff();
        sendFrame(frame);
    }

    private int getPosition() {
        try {
            int pos = Integer.parseInt(etPosition.getText().toString());
            if (pos < 0 || pos > 89) {
                Toast.makeText(this, "位置范围: 0-89", Toast.LENGTH_SHORT).show();
                return -1;
            }
            return pos;
        } catch (NumberFormatException e) {
            Toast.makeText(this, "请输入有效位置", Toast.LENGTH_SHORT).show();
            return -1;
        }
    }

    private void sendFrame(byte[] frame) {
        if (!serialHelper.isConnected()) {
            appendLog("未连接串口，无法发送", "error");
            return;
        }
        boolean success = serialHelper.send(frame);
        if (success) {
            appendLog(">> " + Protocol.bytesToHex(frame) + " (" + Protocol.getCmdName(frame[2] & 0xFF) + ")", "send");
        } else {
            appendLog("发送失败", "error");
        }
    }

    /**
     * 接收数据处理
     */
    private void onDataReceived(byte[] data) {
        handler.post(() -> {
            // 追加到缓冲区
            if (recvBufferLen + data.length > recvBuffer.length) {
                recvBufferLen = 0;
            }
            System.arraycopy(data, 0, recvBuffer, recvBufferLen, data.length);
            recvBufferLen += data.length;

            // 尝试解析帧
            while (recvBufferLen >= 5) {
                Protocol.FrameInfo frame = Protocol.parseFrame(recvBuffer, recvBufferLen);
                if (frame == null) break;

                int frameLen = 4 + frame.data.length * 2 + 1;
                byte[] frameBytes = new byte[frameLen];
                System.arraycopy(recvBuffer, 0, frameBytes, 0, frameLen);

                if (frame.crcError) {
                    appendLog("<< " + Protocol.bytesToHex(frameBytes) + " (CRC错误)", "recv");
                } else {
                    appendLog("<< " + Protocol.bytesToHex(frameBytes) + " (" + Protocol.getCmdName(frame.cmd) + ")", "recv");
                }

                recvBufferLen -= frameLen;
                if (recvBufferLen > 0) {
                    System.arraycopy(recvBuffer, frameLen, recvBuffer, 0, recvBufferLen);
                }
            }
        });
    }

    /**
     * 追加日志
     */
    private void appendLog(String message, String type) {
        String time = timeFormat.format(new Date());
        String prefix;
        switch (type) {
            case "send":  prefix = ">> 发送"; break;
            case "recv":  prefix = "<< 接收"; break;
            case "error": prefix = "!! 错误"; break;
            default:      prefix = "   信息"; break;
        }
        String line = "[" + time + "] " + prefix + ": " + message + "\n";
        tvLog.append(line);
        // 自动滚动到底部
        scrollLog.post(() -> scrollLog.fullScroll(ScrollView.FOCUS_DOWN));
    }

    private void updateUI(boolean connected) {
        btnConnect.setEnabled(!connected);
        btnDisconnect.setEnabled(connected);
        spinnerBaudRate.setEnabled(!connected);
        tvStatus.setText(connected ? "已连接" : "未连接");
        statusDot.setBackgroundColor(connected ? 0xFF4CAF50 : 0xFFCCCCCC);

        btnLightOn.setEnabled(connected);
        btnLightOff.setEnabled(connected);
        btnLightAllOn.setEnabled(connected);
        btnLightAllOff.setEnabled(connected);
    }
}
