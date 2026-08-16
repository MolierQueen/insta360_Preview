# 只读相机探针运行说明

该探针只允许两个命令：读取相机/存储信息（8）和读取文件列表（13）。原开源客户端连接时会同步相机时间，本项目已明确禁用该写操作。

## 运行前

1. 在相机上开启 Wi-Fi。
2. Mac 连接相机的 Wi-Fi 热点。
3. 完全退出手机上的 Insta360 App，避免相机被另一个客户端占用。
4. 保持相机亮屏且不要开始录像。

## 运行

当前相机已确认使用新版 `UCD2` 封装。请先运行完全被动的抓帧工具；它连接后只调用 `recv()`，不会向相机发送应用数据：

```bash
cd /Users/molier/Desktop/Myself/insta360
.venv/bin/python tools/capture_ucd2_passive.py
```

请连续运行两次，以确认每次新连接中尾字段是否重复。结果文件名为 `ucd2-passive-*.json` 和 `ucd2-passive-*.log`。

下面的旧协议探针仅保留用于 ONE RS 等旧机型；当前这台相机无需再次运行：

```bash
cd /Users/molier/Desktop/Myself/insta360
.venv/bin/python tools/probe_camera_readonly.py
```

成功时终端会输出相机信息和文件列表。无论成功或失败，结果都会保存在：

```text
/Users/molier/Desktop/Myself/insta360/output/
```

其中：

- `probe-*.json`：结构化响应；
- `probe-*.log`：握手、命令和错误日志。

## 常见失败

- `同步握手失败`：确认 Mac 当前地址是 `192.168.42.x`，网关为 `192.168.42.1`。
- `Connection refused`：相机 Wi-Fi/控制服务没有启动。
- `camera is busy`：关闭官方 App，或重启相机 Wi-Fi 后重试。
- `文件列表响应超时`：该机型可能使用了更新的命令或授权流程；保留 JSON 和日志继续适配，不要运行原仓库的 `insta360-test`。

## 安全限制

不要运行 vendored 仓库中的 `insta360-test`。它包含同步时间、修改拍摄参数、拍照和录像命令。本项目的探针通过命令白名单阻止这些操作。
