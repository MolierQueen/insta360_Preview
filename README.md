# Insta Library 源码说明

Insta Library 是一个 macOS / Windows 本地只读素材浏览器。电脑连接 Insta360 相机 Wi-Fi 后，应用通过本机服务读取相机目录，在浏览器中展示照片、视频、日期分组和批量下载，并提供可选相框导出、视频时间轴预览及 2:1 全景照片的 360° 拖拽查看。

这份源码可以直接打出 Apple Silicon、Intel 和 Windows x64 三种包。打好的成品里会带上 Python、Node.js、前端页面和运行依赖，使用的人不需要再装开发环境。

> 项目坚持只读边界：控制通道只发送已经验证的读取命令，不提供拍摄、修改设置或删除文件功能。

## 目录结构

```text
assets/                 App 原始图标
docs/                   实现原理与开发文档
packaging/              App 元数据、启动器、离线 Python 依赖
tests/                  协议、安全和后端测试
tools/                  本地服务、启动及打包脚本
vendor/                 只读协议定义与许可证
web/                    React/vinext 前端源码
README.html             可直接用浏览器打开的完整实现文章
README.md               本文件
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

进入仓库目录：

```bash
cd /path/to/repo
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm --prefix web ci
```

`npm ci` 会按 `web/package-lock.json` 安装前端依赖。不要把 `node_modules` 提交进仓库。

## 本地开发

```bash
.venv/bin/python tools/run_web_app.py
```

脚本会启动本地 API 和开发页面。改前端后浏览器会自动刷新。退出时按 `Control-C`。

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

如果改了协议或媒体代理，最好把测试完整跑一遍，确认只读限制还在。

## 打包 App

打 Apple Silicon：

```bash
tools/build_distributions.sh arm64
```

打 Intel：

```bash
tools/build_distributions.sh x86_64
```

两个一起打：

```bash
tools/build_distributions.sh all
```

打 Windows x64：

```bash
tools/build_windows_distribution.sh
```

第一次打包时，脚本会自动下载对应架构的 Python 3.14 和 Node.js 22，并缓存到 `.build-cache/`。之后再打会直接复用缓存。

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

Windows 这边把 ZIP 完整解压后，双击 `Insta Library.cmd` 就能跑。

发给别人时，优先发 ZIP，不要直接发 `.app` 文件夹。

## 常见打包失败与处理

- `missing build command: xxx`：少工具。先装 Xcode Command Line Tools，再检查 `node`、`npm`、`python3`、`clang` 能不能用。
- `npm --prefix web ci` 失败：多半是 Node 版本不对，或者网络拉包失败。先用 Node 22，再重试。
- `pip install -r requirements.txt` 失败：多半是 Python 版本不对，或者虚拟环境没建好。重新跑一遍 `python3 -m venv .venv` 和安装命令。
- `curl` 下载运行时失败：第一次打包必须联网。检查网络、代理或防火墙后重试。
- `missing Ultra HDR codec`：源码目录里缺少 `vendor/ultrahdr/macos-*` 对应文件，要先补齐。
- `codesign` 失败：一般是 Xcode Command Line Tools 没装好。先执行 `xcode-select --install`，不行的话再切一下工具链。
- `Insta Library-Apple-Silicon is still running` 或 `Insta Library-Intel is still running`：先把旧版 App 关掉，再重新打。
- App 打出来了但打不开：这是本地签名导致的。右键 App 选“打开”即可。要正式分发的话，还是建议你自己重新签名和公证。

## 重新生成源码包

在完整项目目录中执行：

```bash
tools/build_source_package.sh
```

结果是 `dist/InstaLibrary-Source.zip`。脚本会自动排除 `.venv`、`node_modules`、前端构建目录、Git 元数据和本机缓存。

## 使用方式

1. 打开相机 Wi-Fi 热点。
2. 让 Mac 连接相机 Wi-Fi。
3. 双击对应架构的 Insta Library App。
4. 在网页中点击“连接相机”。
5. 完成后点击“断开并退出”。

当前是 ad-hoc 本地签名。别的 Mac 第一次打开时，可能需要在 Finder 里右键 App 再点“打开”。如果你要正式分发，最好还是用自己的 Apple Developer ID 重新签名并公证。

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
