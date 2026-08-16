# Insta Library 分发说明

## 给普通使用者

- Apple 芯片（M1 / M2 / M3 / M4 / M5）请选择 `Insta-Library-Apple-Silicon.zip`。
- Intel 芯片请选择 `Insta-Library-Intel.zip`。
- Windows 10 / 11 64 位请选择 `Insta-Library-Windows-x64.zip`，完整解压后双击 `Insta Library.cmd`。
- 解压后把 `.app` 拖进“应用程序”即可。应用已经包含 Python、Node.js、网页和协议代码，不需要另外安装开发环境。
- 第一次打开若被 macOS 拦截，请在 Finder 中右键应用，选择“打开”。这是因为当前分发包使用本地签名，没有使用付费的 Apple Developer ID 公证。

使用时先连接相机 Wi-Fi，再启动应用并在网页中点击“连接相机”。网页里的“退出应用”会停止本地服务；通常不再需要回到终端按 `Control-C`。

## 给二次开发者

可以。朋友只靠这个 Git 仓库里的内容，就能自己重新打包不同架构的 App；仓库已经包含源码、前端、协议定义、图标、测试和打包脚本。首次打包时脚本会自动从官方源下载对应架构的 Python 3.14 与 Node.js 22 运行时，所以打包机器第一次执行时需要联网。

先克隆仓库并进入源码目录：

```bash
git clone git@github.com:MolierQueen/insta360_Preview.git
cd insta360_Preview/InstaLibrary-Source
```

准备开发依赖：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm --prefix web ci
```

如果没有安装 Xcode Command Line Tools，先执行：

```bash
xcode-select --install
```

打包 Apple Silicon 版：

```bash
tools/build_distributions.sh arm64
```

打包 Intel 版：

```bash
tools/build_distributions.sh x86_64
```

同时打包 Apple Silicon 和 Intel：

```bash
tools/build_distributions.sh all
```

打包 Windows x64 便携版：

```bash
tools/build_windows_distribution.sh
```

生成完成后，产物会出现在当前目录下的 `dist/`：

```text
Insta Library-Apple-Silicon.app
Insta Library-Intel.app
Insta-Library-Apple-Silicon.zip
Insta-Library-Intel.zip
Insta Library-Windows-x64/
Insta-Library-Windows-x64.zip
```

补充说明：

- macOS 打包环境需要 `clang`、`codesign`、`curl`、`ditto`、`node`、`npm`、`python3`、`rsync`、`sips`、`tar`。
- Windows 打包脚本也可以在 macOS 上执行，它会自动下载 Windows x64 的 Python 和 Node 运行时。
- 更完整的开发和打包说明见 `InstaLibrary-Source/README.md`、`README.html` 与 `DEVELOPMENT.md`。

本项目以只读浏览和下载为边界，不提供删除、拍摄或修改相机参数的命令。项目为独立研究成果，与 Insta360 官方无隶属或背书关系。
