# Insta Library 二次开发指南

## 开发环境

- macOS 11 或更高版本
- Node.js 22.13 或更高版本
- Python 3.10 或更高版本
- Xcode Command Line Tools（用于生成 macOS 启动器）

## 首次安装

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cd web
npm install
```

## 本地开发

```bash
cd /path/to/InstaLibrary-Source
.venv/bin/python tools/run_web_app.py
```

前端页面位于 `web/app/page.tsx`，样式位于 `web/app/globals.css`。本地只读 API 位于 `tools/insta360_web_server.py`，固定只读协议帧及解析逻辑位于 `tools/probe_ucd2_replay_readonly.py`。

## 测试

```bash
.venv/bin/python -m unittest discover -s tests -v
npm --prefix web test
```

## 重新打包

构建当前 Mac 架构：

```bash
tools/build_distributions.sh arm64
# 或
tools/build_distributions.sh x86_64
```

一次构建两种架构：

```bash
tools/build_distributions.sh all
```

构建脚本会自动下载目标架构的 Python 与 Node.js 运行时、从 PNG 生成 App 图标，并生成 ad-hoc 签名的 App 和 ZIP。首次构建需要联网；下载内容会缓存在 `.build-cache`。公开分发前，如有 Apple Developer ID，应使用自己的证书重新签名并完成公证。

## 安全约束

控制通道只允许命令 8（读取设备/存储选项）和命令 13（读取文件列表）。不要在未理解协议副作用的情况下扩展允许列表。文件代理只能访问本次相机目录中出现过的精确路径。
