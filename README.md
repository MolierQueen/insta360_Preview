# Insta Library 分发说明

## 给普通使用者

- Apple 芯片（M1 / M2 / M3 / M4 / M5）请选择 `Insta-Library-Apple-Silicon.zip`。
- Intel 芯片请选择 `Insta-Library-Intel.zip`。
- Windows 10 / 11 64 位请选择 `Insta-Library-Windows-x64.zip`，完整解压后双击 `Insta Library.cmd`。
- 解压后把 `.app` 拖进“应用程序”即可。应用已经包含 Python、Node.js、网页和协议代码，不需要另外安装开发环境。
- 第一次打开若被 macOS 拦截，请在 Finder 中右键应用，选择“打开”。这是因为当前分发包使用本地签名，没有使用付费的 Apple Developer ID 公证。

使用时先连接相机 Wi-Fi，再启动应用并在网页中点击“连接相机”。网页里的“退出应用”会停止本地服务；通常不再需要回到终端按 `Control-C`。

## 给二次开发者

`InstaLibrary-Source.zip` 包含后端、前端、协议定义、图标、测试、构建脚本和完整实现文档。解压后先阅读根目录的 `README.html` 与 `DEVELOPMENT.md`。

本项目以只读浏览和下载为边界，不提供删除、拍摄或修改相机参数的命令。项目为独立研究成果，与 Insta360 官方无隶属或背书关系。
