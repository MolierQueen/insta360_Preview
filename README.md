# Insta Library

## 这是什么

Insta Library 是一个连接 Insta360 相机 Wi‑Fi 后，直接在电脑上浏览 SD 卡素材的本地应用，不依赖 Insta360 原生 App 或官方 SDK。它支持照片与视频预览、日期分组、批量下载、360° 照片查看，以及单张照片的相框和 HDR 导出。

应用支持 Apple Silicon Mac、Intel Mac 和 Windows x64，打包后的版本已经内置 Python、Node.js 与运行资源，使用者无需配置开发环境。

## 让 AI 自动打包

使用 Agent 打开本仓库，然后输入：

```text
$build-insta-library 帮我运行测试并生成所有可分发产物
```

也可以指定“只生成 Apple Silicon”“生成 Intel Mac”“生成 Windows x64”或“生成源码包”。Skill 会自动检查环境、安装缺失的项目依赖、运行测试并把结果放到不会提交 Git 的 `Product/`。

首次构建需要联网下载运行时；Mac 应用必须在 macOS 上构建，Windows 可以生成 Windows x64 包。
