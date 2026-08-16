# Insta Library 分发说明

## 给普通使用者

- Apple 芯片（M1 / M2 / M3 / M4 / M5）请选择 `Insta-Library-Apple-Silicon.zip`。
- Intel 芯片请选择 `Insta-Library-Intel.zip`。
- Windows 10 / 11 64 位请选择 `Insta-Library-Windows-x64.zip`，完整解压后双击 `Insta Library.cmd`。
- 解压后把 `.app` 拖进“应用程序”即可。应用已经包含 Python、Node.js、网页和协议代码，不需要另外安装开发环境。
- 第一次打开若被 macOS 拦截，请在 Finder 中右键应用，选择“打开”。这是因为当前分发包使用本地签名，没有使用付费的 Apple Developer ID 公证。

使用时先连接相机 Wi-Fi，再启动应用并在网页中点击“连接相机”。网页里的“退出应用”会停止本地服务；通常不再需要回到终端按 `Control-C`。

## 给二次开发者

这个仓库主要放源码，不放完整的 Windows 成品包。想用的话，直接自己打包就行。第一次打包需要联网，因为脚本会自动下载 Python 和 Node 运行时。

仓库里也不再放 `InstaLibrary-Source.zip` 这种源码压缩包。已经有完整的 `InstaLibrary-Source/` 目录了，需要的话自己执行打包脚本重新生成就行。

先拉代码并进入源码目录：

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

如果没有装 Xcode Command Line Tools，先执行：

```bash
xcode-select --install
```

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

打完后的文件在 `dist/` 目录里：

```text
Insta Library-Apple-Silicon.app
Insta Library-Intel.app
Insta-Library-Apple-Silicon.zip
Insta-Library-Intel.zip
Insta Library-Windows-x64/
Insta-Library-Windows-x64.zip
```

说明：

- Windows 包也可以在 macOS 上打。
- 更详细的开发说明看 `InstaLibrary-Source/README.md`、`README.html` 和 `DEVELOPMENT.md`。

常见问题：

- `missing build command: xxx`：少工具。先装 Xcode Command Line Tools，再检查 `node`、`npm`、`python3`、`clang` 能不能用。
- `npm --prefix web ci` 失败：多半是 Node 版本不对，或者网络拉包失败。先用 Node 22，再重试。
- `pip install -r requirements.txt` 失败：多半是 Python 版本不对，或者虚拟环境没建好。重新跑一遍 `python3 -m venv .venv` 和安装命令。
- `curl` 下载运行时失败：第一次打包必须联网。检查网络、代理或防火墙后重试。
- `missing Ultra HDR codec`：源码目录里缺少 `vendor/ultrahdr/macos-*` 对应文件，要先补齐。
- `codesign` 失败：一般是 Xcode Command Line Tools 没装好。先执行 `xcode-select --install`，不行的话再切一下工具链。
- `Insta Library-Apple-Silicon is still running` 或 `Insta Library-Intel is still running`：先把旧版 App 关掉，再重新打。
- App 打出来了但打不开：这是本地签名导致的。右键 App 选“打开”即可。要正式分发的话，还是建议你自己重新签名和公证。

本项目以只读浏览和下载为边界，不提供删除、拍摄或修改相机参数的命令。项目为独立研究成果，与 Insta360 官方无隶属或背书关系。
