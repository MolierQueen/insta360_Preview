# Insta360 Wi‑Fi 直连 Mac 与 SD 卡浏览方案（修订版）

更新时间：2026-08-02  
目标环境：Apple Silicon macOS  
状态：已纳入此前真机探测结果，OSC 不再作为默认前提

## 1. 修正后的结论

这个项目理论上可做，但目前**不能直接进入桌面 UI 开发**。真正缺少的是相机在 `6666/tcp` 上的会话建立/认证协议。

此前真机测试已经证明：

- Mac 连接相机 Wi‑Fi 后取得 `192.168.42.33`；
- 网关/相机地址是 `192.168.42.1`，所以基本路由没有问题；
- 相机开放 `80/tcp`，服务是 nginx；
- 相机开放 `6666/tcp`，会主动发送以 `UCD2` 开头的 16 字节数据；
- `/DCIM`、`/DCIM/` 等真实目录返回 `401 Authorization Required`；
- 这个 `401` 没有标准的 `WWW-Authenticate`，不能用普通 Basic/Digest 登录；
- `/osc/info` 等 OSC 路径没有得到官方文档中的正常响应；
- 向 `6666` 发送单字节 `00/01/02/.../ff` 只会得到固定握手响应，之后服务等待完整协议帧。

因此当前相机的实际链路更可能是：

```text
客户端
  │
  ├── 6666/tcp：UCD2 私有控制协议
  │     - 握手/配对
  │     - 心跳
  │     - 查询文件列表
  │     - 返回文件 URI 或 HTTP 会话信息
  │
  └── 80/tcp：nginx 文件数据通道
        - 已知文件 URI 的下载
        - 可能要求临时 token/cookie/header
```

`/DCIM` 的 401 也可能仅表示“禁止目录枚举”；在不知道一个真实文件 URL 前，暂时不能断言每次文件 GET 都需要 token。必须通过一个工作的 SDK 客户端抓到实际请求后确认。

## 2. 为什么上一版 OSC 方案不成立

Insta360 官方确实为部分 X 系列相机公开了 [OSC 协议](https://github.com/Insta360Develop/Insta360_OSC)，官方选型文档也将 OSC 描述为跨平台 HTTP 方案。但“某产品系列有 OSC 文档”不代表“当前具体型号和固件一定启用了 OSC”。

这台相机已经实际探测过，公开 OSC 入口没有工作。因此 OSC 只能保留为能力探测分支，不能作为架构基础。

另外：

- [iOS SDK V1.9.2](https://github.com/Insta360Develop/iOS-SDK/blob/V1.9.2/README_zh.md) 明确提供连接、文件列表和下载接口，但底层实现是闭源 XCFramework；
- [Desktop Camera SDK](https://github.com/Insta360Develop/Desktop-CameraSDK-Cpp) 当前官方文档只支持 Windows/Linux，并且只支持 USB，不解决本次 macOS + Wi‑Fi 需求。

## 3. 新发现：已有开源的 6666/Protobuf 实现

公开仓库 [RigacciOrg/insta360-wifi-api](https://github.com/RigacciOrg/insta360-wifi-api) 已经实现了与当前探测结果高度一致的协议：

- 连接 `192.168.42.1:6666`；
- TCP 包前 4 字节以 little-endian 表示总长度；
- 同步包类型为 `06 00 00`，后接魔数 `syNceNdinS`；
- 心跳包类型为 `05 00 00`；
- 命令包类型为 `04 00 00`；
- 命令码为 2 字节 little-endian；
- 使用 24-bit 自增序列号关联请求和响应；
- 第 16 字节之后为 Protobuf payload；
- 文件列表命令码是 `13`，仓库已经实现 `GetCameraFilesList()`；
- 仓库自带可直接用于 Python 的 `pb2` 文件，不需要官方 SDK。

该实现基于 ONE RS 和 Android App 逆向得到，不能直接保证兼容所有新机型。但当前相机同样开放 6666 且返回 UCD2 固定握手，值得将它作为第一优先级兼容性测试。

最短验证路径：

1. 只运行连接、同步和心跳；
2. 调用 `GetCameraInfo()`；
3. 调用 `GetCameraFilesList()`；
4. 打印响应中的文件 URI，不执行拍摄、删除或设置命令；
5. 用一个真实 URI 测试端口 80 是否可直接 GET；
6. 若返回 401，再检查列表响应中是否有 token、authorization 字段或专用下载 URI。

该仓库使用 GPL-3.0。可以直接用于协议验证；如果最终产品不准备遵守 GPL 分发要求，应把它作为行为参考，重新实现干净的最小客户端，并在发布前做许可证审查。

## 4. 正确的技术路线

不要继续猜 `6666` 的单字节命令，也不要先做网页。优先完成 Gate 0；只有它失败，才考虑后续 Gate。

### Gate 0：测试开源 Wi‑Fi 客户端

这是当前成本最低的路线，不需要官方 SDK、IPA 或抓包。

- 固定只读测试范围；
- 保存原始收发包；
- 检查同步响应、相机信息和文件列表；
- 按相机型号/固件记录兼容性。

判定：

- 能返回文件列表：直接补齐 HTTP 下载并进入产品适配；
- 能握手但文件列表解析失败：保留帧层，仅更新对应 Protobuf schema；
- 同步包即被拒绝：进入 Gate B，抓取新固件的真实协议；
- 连接过程中出现异常：立即停止，不发送拍摄、删除、设置或升级命令。

### Gate A：验证 iOS SDK 能否直接运行在 Apple Silicon Mac

这是 Gate 0 不兼容时的官方 SDK 备选路线。

1. 向 Insta360 [申请最新 SDK](https://www.insta360.com/sdk/apply)，取得 Demo 和以下框架：
   - `INSCameraSDK.xcframework`
   - `INSCameraServiceSDK.xcframework`
   - `INSCoreMedia.xcframework`
2. 检查 XCFramework 的平台 slice：
   - 是否包含 `macos-arm64`；
   - 是否包含 `ios-arm64_x86_64-maccatalyst`；
   - 如果只有 `ios-arm64`，再验证 “My Mac (Designed for iPad)” 运行方式。
3. 做一个最小 SwiftUI/iOS 工程，只实现：
   - `INSCameraManager.socket().setup()`；
   - 判断 `INSCameraStateConnected`；
   - `fetchPhotoListWithOptions`；
   - `fetchResourceWithURI` 下载一个小文件。

判定：

- 如果可以直接在 Mac 运行：采用 SDK 封装路线，不逆向协议；
- 如果链接、签名或运行时不兼容：进入 Gate B；
- 如果 SDK 协议条款不允许目标使用方式：停止该路线，先向 Insta360 确认授权。

这一项必须拿到实际 XCFramework 后判断，README 本身不能证明 macOS 兼容或不兼容。

### Gate B：用自己的 iOS SDK 客户端获取真实协议样本

若 SDK 不能直接在 Mac 跑，就在 iPhone 上运行我们自己的最小测试 App。它仍然不依赖 Insta360 官方 App，并且接口调用和响应由我们控制。

测试 App 只做四个操作，每次单独抓包：

1. 连接并保持 10 秒；
2. 拉取一次文件列表；
3. 拉取一个缩略图；
4. 下载一个已知小文件。

Mac 通过 USB 为 iPhone 创建 Remote Virtual Interface，然后抓取原始网络流量：

```bash
rvictl -s <iPhone-UDID>
sudo tcpdump -i rvi0 -n -s 0 -w insta360-list.pcap \
  'host 192.168.42.1 and (tcp port 6666 or tcp port 80)'
```

这与 Charles 不同：Charles 只能看到遵守系统 HTTP 代理的流量；`rvictl` 捕获 iPhone 网络接口上的原始 TCP/IP，所以自定义 socket 和直连 HTTP 也能看到。

每次抓包必须同步保存：

- SDK 日志；
- 操作开始/结束的准确时间；
- iOS SDK 返回的文件 URI；
- 端口 6666 的完整双向 TCP stream；
- 端口 80 的请求行、header 和状态码；
- 相机型号、固件、App/SDK 版本。

判定：

- 若 6666 payload 可读或结构稳定，进入 Gate C；
- 若 payload 加密，先检查 SDK 日志、公开头文件、符号和 protobuf descriptor；
- 若仍无法解释，才考虑在许可允许范围内对 SDK 二进制做动态插桩；
- 不建议从官方 IPA 开始，它比分析自己可控的 SDK Demo 成本更高。

### Gate C：实现 macOS 的 UCD2 协议适配器

目标不是完整复制相机控制协议，只实现 SD 卡浏览需要的最小子集：

```text
connect
handshake/pair
heartbeat
get camera info
get storage status
list media files
get thumbnail/file URI
download file over HTTP
disconnect
```

实现顺序：

1. 识别 UCD2 帧头、长度、消息 ID、序列号和校验字段；
2. 识别请求/响应关联方式；
3. 复现握手和心跳；
4. 复现列表请求；
5. 用响应中的真实 URI 请求端口 80；
6. 识别 token/cookie/header 的来源和有效期；
7. 建立重连和超时状态机；
8. 再封装成稳定的 `CameraAdapter`。

不要一开始实现拍摄、直播、改参数、升级固件和删除文件，这些都会扩大协议面和设备风险。

## 4. 最终产品架构

协议打通后，产品仍可使用本地 Web 界面，但后端必须是原生进程：

```text
Insta360 Camera
  ├── TCP 6666 / UCD2
  └── HTTP 80 / files
          │
          ▼
macOS Camera Service（Rust 或 Swift）
  ├── CameraAdapter
  │     ├── OfficialSDKAdapter（若 Gate A 成功）
  │     └── UCD2Adapter（若 Gate C 成功）
  ├── 文件分组与缩略图缓存
  ├── 下载队列/断点续传
  └── localhost API / Tauri IPC
          │
          ▼
Web/Tauri UI
```

适配器接口先固定为：

```text
probe() -> CameraInfo
connect() -> Session
storageStatus() -> StorageStatus
listMedia(cursor) -> MediaPage
thumbnail(mediaId) -> bytes
download(componentId, destination, progress)
disconnect()
```

这样无论最后是 SDK 还是 UCD2，UI 和下载管理都不用重写。

## 5. 文件与素材模型

一个 360° 素材可能由 `_00`、`_10`、LRV、DNG 或 HDR 文件组构成。不能把单个 SD 卡文件直接当成一个完整素材。

```text
MediaGroup
  captureId
  mediaType
  capturedAt
  width / height
  totalBytes
  thumbnail
  components[]
    role: main_00 | main_10 | lrv | dng | unknown
    cameraUri
    downloadUri
    bytes
```

第一版仅浏览、显示元数据和下载完整文件组。`.insv/.insp` 的完整拼接、FlowState 和导出是后续独立项目。

## 6. 推荐交付阶段

### P0：信息补齐和 SDK 获取

输入：具体相机型号、固件版本、iPhone 型号/iOS 版本。  
输出：SDK 包、许可结论、XCFramework slice 检查结果。

### P1：Gate A 最小验证（1～2 天，不含 SDK 审批时间）

输出：Mac 上成功列一个文件，或者有证据证明框架不能在 Mac 运行。

### P2：Gate B 可重复抓包（1～3 天）

输出：四份独立 pcap、SDK 日志、真实 URI、HTTP header 和操作时间线。

### P3：协议最小复现（时间取决于加密情况）

输出：Mac CLI 能连接、列文件、下载一个文件。

只有 P3 完成后，才适合承诺桌面产品开发时间。未看真实协议前给“几天完成 UI 和下载”的估算是不可靠的。

### P4：桌面产品

- 只读媒体网格；
- 照片/视频筛选；
- 文件组详情；
- 批量下载；
- 中断恢复；
- 断线、休眠、忙碌和无卡提示。

删除、拍摄控制、直播和固件升级均不进入首版。

## 7. 备选路线

### 备选 1：iPhone Bridge

如果真机直连 Mac 的 UCD2 复现成本过高，可以用自研 iOS SDK App 连接相机，再在同一 Wi‑Fi 中向 Mac 暴露只读 HTTP 接口。

```text
Camera ←Wi‑Fi→ iPhone Bridge ←局域网→ Mac Web UI
```

优点是全部通过官方 iOS SDK；缺点是仍需要 iPhone，不满足“Mac 直接连接”的最终目标。

### 备选 2：USB

若目标只是高可靠地导出 SD 卡文件，USB/U 盘模式远比 Wi‑Fi 私有协议稳定。它不满足无线需求，但可作为正式产品中的恢复通道。

### 备选 3：OSC 能力探测

对其他型号或新固件仍可先试 `/osc/info`。只有收到合法相机 JSON 后才启用 `OSCAdapter`，不能根据型号宣传资料直接假设可用。

## 8. 风险和停止条件

| 风险 | 应对 |
|---|---|
| SDK 不含 macOS/Catalyst slice | 尝试 Designed for iPad；失败后进入抓包路线 |
| UCD2 payload 加密 | 从 SDK 日志、头文件、符号、protobuf descriptor 入手 |
| HTTP 文件服务需要短期 token | 复现 token 获取和续期，不猜用户名密码 |
| 固件升级改变协议 | 保存型号/固件能力矩阵和抓包 fixture |
| 相机只允许一个客户端 | SDK 测试或 Mac 工具运行时关闭官方 App |
| SDK 许可禁止目标用途或协议分析 | 停止该路线，向 Insta360 获取书面授权 |
| 协议涉及设备写操作 | 首版只读，不发送删除、格式化、升级命令 |

## 9. 当前下一步

现在不再扫描端口，也不再向 `6666` 发送猜测字节。下一步按顺序做：

1. 确认**相机具体型号和固件版本**；
2. 用 `insta360-wifi-api` 进行只读兼容性测试；
3. 如果能列出文件，直接补齐 HTTP 下载；
4. 只有开源客户端不兼容时，才继续申请 SDK 或执行 `rvictl` 抓包。

因此当前已经不必等待 SDK 才能继续。
