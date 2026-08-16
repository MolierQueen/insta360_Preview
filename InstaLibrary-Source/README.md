# Insta Library 源码说明

Insta Library 是一个 macOS / Windows 本地只读素材浏览器。电脑连接 Insta360 相机 Wi-Fi 后，应用通过本机服务读取相机目录，在浏览器中展示照片、视频、日期分组和批量下载，并提供可选相框导出、视频时间轴预览及 2:1 全景照片的 360° 拖拽查看。

这份源码可以直接生成当前版本的 Apple Silicon App、Intel App，或同时生成两种版本。成品会内置 Python、Node.js、前端页面和运行依赖，使用者不需要再安装开发环境。

> 项目坚持只读边界：控制通道只发送已经验证的读取命令，不提供拍摄、修改设置或删除文件功能。

> Git 仓库不保留完整的 Windows 预构建便携目录，避免提交不完整产物；Windows 使用者请按本文命令自行重新打包。

## 目录结构

```text
InstaLibrary-Source/
├── assets/                 App 原始图标
├── docs/                   实现原理与开发文档
├── packaging/              App 元数据、启动器、离线 Python 依赖
├── tests/                  协议、安全和后端测试
├── tools/                  本地服务、启动及打包脚本
├── vendor/                 只读协议定义与许可证
├── web/                    React/vinext 前端源码
├── README.html             可直接用浏览器打开的完整实现文章
└── README.md               本文件
```

## 环境要求

- macOS 11 或更高版本
- Node.js 22.13 或更高版本
- Python 3.10 或更高版本
- Xcode Command Line Tools
- 首次安装依赖、首次打包时需要互联网

检查环境：

```bash
node --version
python3 --version
clang --version
```

如果没有 Command Line Tools：

```bash
xcode-select --install
```

## 首次准备

进入解压后的源码目录：

```bash
cd /path/to/InstaLibrary-Source
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm --prefix web ci
```

`npm ci` 会严格按照 `web/package-lock.json` 安装前端依赖。不要把 `node_modules` 提交或复制进源码包。

## 本地开发

```bash
.venv/bin/python tools/run_web_app.py
```

脚本会启动本地 API 和开发页面。修改前端文件后浏览器会自动更新。退出开发服务时在终端按 `Control-C`。

主要修改入口：

- `web/app/page.tsx`：界面、选择、分页、视频播放器和 360° 查看器
- `web/app/globals.css`：界面样式与响应式布局
- `tools/insta360_web_server.py`：相机目录、媒体代理和 Range 转发
- `tools/probe_ucd2_replay_readonly.py`：固定只读帧及协议解析
- `packaging/Info.plist`：App 名称、版本号和 Bundle ID

## 运行测试

```bash
.venv/bin/python -m unittest discover -s tests -v
npm --prefix web test
```

修改协议或媒体代理时，至少执行一次完整测试，确保只读命令白名单和文件路径白名单没有被破坏。

## 打包 App

生成 Apple Silicon 版本：

```bash
tools/build_distributions.sh arm64
```

生成 Intel 版本：

```bash
tools/build_distributions.sh x86_64
```

同时生成两个版本：

```bash
tools/build_distributions.sh all
```

生成 Windows 10 / 11 x64 便携版（可以在 macOS 上交叉打包）：

```bash
tools/build_windows_distribution.sh
```

首次运行打包脚本时，会自动下载对应架构的 Python 3.14 和 Node.js 22 运行时，并缓存在 `.build-cache/`。再次打包会直接使用缓存。

输出位于 `dist/`：

```text
dist/
├── Insta Library-Apple-Silicon.app
├── Insta Library-Intel.app
├── Insta-Library-Apple-Silicon.zip
├── Insta-Library-Intel.zip
├── Insta Library-Windows-x64/
├── Insta-Library-Windows-x64.zip
└── README-分发说明.md
```

Windows 使用者应完整解压 ZIP，然后双击 `Insta Library.cmd`。Windows 包同样内置 Python、Node.js 和全部运行资源，不需要额外安装开发环境。

给其他人发送时优先发送 ZIP，不要直接发送 `.app` 文件夹，以免包结构或扩展属性在传输中损坏。

## 常见打包失败与处理

- `missing build command: xxx`：本机缺少脚本依赖。先安装 Xcode Command Line Tools，确认 `node --version`、`npm --version`、`python3 --version`、`clang --version` 都能正常输出。
- `npm --prefix web ci` 失败：通常是 Node 版本过低或网络拉包失败。先升级到 Node.js 22，再重新执行 `npm --prefix web ci`。
- `pip install -r requirements.txt` 失败：通常是 Python 版本过低，或虚拟环境没有正确激活。建议重新执行 `python3 -m venv .venv`，再用 `.venv/bin/python -m pip install -r requirements.txt`。
- `curl` 下载运行时失败：首次打包需要联网下载 Python 3.14 和 Node.js 22 运行时。检查网络、代理、防火墙后重试；成功下载后缓存会保存在 `.build-cache/`。
- `missing Ultra HDR codec for arm64` 或 `missing Ultra HDR codec for x86_64`：当前源码目录缺少对应架构的 `vendor/ultrahdr/macos-*` 可执行文件，需先补齐该目录内容，再重新打包。
- `codesign` 失败：一般是 Xcode Command Line Tools 没装好，或系统签名工具异常。先执行 `xcode-select --install`，必要时执行 `sudo xcode-select -switch /Library/Developer/CommandLineTools` 后重试。
- `Insta Library-Apple-Silicon is still running` 或 `Insta Library-Intel is still running`：旧版 App 还在运行，脚本为了避免覆盖正在使用的 bundle 会直接退出。先在应用里点击“退出应用”，或在活动监视器里结束相关进程，再重新打包。
- 产物生成了但双击打不开：当前是 ad-hoc 本地签名，其他 Mac 第一次打开时可能被 Gatekeeper 拦截。让对方在 Finder 里右键 App 选择“打开”；如果要公开分发，建议用自己的 Apple Developer ID 重新签名并做公证。

## 重新生成源码包

在完整项目目录中执行：

```bash
tools/build_source_package.sh
```

结果为 `dist/InstaLibrary-Source.zip`。脚本会排除 `.venv`、`node_modules`、前端构建目录、Git 元数据和本机缓存。

## 使用方式

1. 打开相机 Wi-Fi 热点。
2. 让 Mac 连接相机 Wi-Fi。
3. 双击对应架构的 Insta Library App。
4. 在网页中点击“连接相机”。
5. 完成后点击“断开并退出”。

当前是 ad-hoc 本地签名。其他 Mac 第一次启动时，可能需要在 Finder 中右键 App，选择“打开”。面向公众发布时，应使用 Apple Developer ID 重新签名并完成公证。

## 媒体预览边界

- JPG、JPEG 和浏览器可解码的 INSP 照片支持单张在本地按原始分辨率合成相框后导出；原文件不会被修改或上传。
- 带增益图的原始照片会保留 HDR：选择 `iPhone · HEIC` 会生成 Apple Adaptive HDR（需要 macOS 15 或更新版本），选择 `Android · JPEG` 会生成向下兼容普通看图软件的 Ultra HDR JPEG。相框白字与 Molier 标志使用高亮增益。
- 内置 Ultra HDR 编码器的单边上限已提高至 32768 像素；竖图加上相框后超过 8192 像素也无需缩小原图。
- 批量下载始终导出原文件，不提供相框合成，避免连续处理多张高分辨率照片占用过多内存。
- 视频优先使用匹配的 LRV 文件预览，原始文件仍可下载。
- MP4/LRV 是否能够播放取决于 macOS 浏览器支持的编码格式。
- 360° 查看器自动识别接近 2:1 的等距柱状照片。
- 未经拼接的双鱼眼原片不能仅靠浏览器还原为完整球面视角。
- DNG 文件提供下载，但浏览器不直接解码。

## 安全说明

本项目并非 Insta360 官方产品。协议适配来自公开资料和只读流量研究，不保证所有相机型号与固件行为完全一致。扩展命令前请先确认副作用，尤其不要把未知控制帧加入允许列表。
