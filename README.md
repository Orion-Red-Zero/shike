# 食刻

食刻是一款面向 Android 的本地饮食能量记录应用。它支持通过文字或照片整理饮食，核对食物与份量后记录热量，并提供四餐汇总、趋势、食物库和数据导出。

[下载最新版本](https://github.com/Orion-Red-Zero/shike/releases/latest) | [查看全部版本](https://github.com/Orion-Red-Zero/shike/releases)

## 当前版本

| 项目 | 信息 |
| --- | --- |
| 版本 | 1.2.0（versionCode 4） |
| 包名 | `app.shike.diet.fixed` |
| 最低系统 | Android 10（API 29） |
| 目标 SDK | Android 35 |

## 主要功能

- 支持文字记录和照片辅助识别候选
- 按早餐、午餐、晚餐和加餐汇总每日摄入
- 提供可跨餐次、跨日期复用的“我的食物库”
- 支持食物名称、别名、每 100 g 营养数据和常用份量
- 提供近 7 天摄入趋势
- 支持 JSON/CSV 数据导入与导出
- 内置食物与主要记录功能可离线使用
- 可选 USDA 在线查询和自定义 HTTPS 照片识别服务

照片识别结果不会直接入账。用户需要确认食物和克数，热量再由本地营养数据重新计算。

## 下载与安装

1. 打开 [Releases](https://github.com/Orion-Red-Zero/shike/releases)。
2. 选择需要的版本，下载 APK 或对应的完整发布 ZIP。
3. 在 Android 设备上打开 APK；若系统提示，仅为当前文件管理器或浏览器允许“安装未知应用”。

升级前请在“我的 → 数据”中导出 JSON/CSV 备份。若系统提示签名冲突，不要直接卸载旧版；卸载或清除应用数据会删除本机记录。

## 数据与隐私

- 饮食记录保存在应用本机存储中。
- 未配置识别服务或未授权上传时，应用不会上传照片。
- USDA 搜索和用户自行配置的照片识别服务需要网络。
- 导出文件通常保存在系统“下载/食刻”目录。
- 单张照片不能可靠确定食物种类和绝对克重，所有候选与份量都需要人工核对。
- 本应用提供饮食记录估算，不用于医疗诊断或处方。

## 源码结构

```text
project/app/src/main/
├── AndroidManifest.xml
├── java/app/shike/diet/fixed/MainActivity.java
├── assets/
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
└── res/

scripts/        APK 构建与资源核验脚本
tests/          静态检查和运行时回归测试
reference/      已发布版本的验证资料
```

应用采用原生 WebView 外壳，主要界面和业务逻辑位于 `project/app/src/main/assets/index.html`。前端资源无需通过 npm 安装。

## 构建

本项目不使用 Gradle，而是通过 Android SDK 命令行工具直接构建。需要：

- Bash、Python 3、Node.js 18+、zip/unzip
- JDK 17
- Android SDK Platform 35
- Android SDK Build-Tools 35.0.0

使用已有签名构建：

```bash
export ANDROID_SDK_ROOT=/你的路径/Android/Sdk
export SHIKE_KEYSTORE=/你的路径/my-release.jks
export SHIKE_KS_PASS='你的签名密码'
bash scripts/build_apk.sh
```

输出文件位于：

```text
build/shike-android-1.2.0.apk
```

签名文件和密码不得提交到仓库。使用新签名生成的 APK 不能覆盖升级由其他证书签名的已安装版本。

更完整的构建参数和签名说明请参阅 [README_zh-CN.md](README_zh-CN.md)。

## 测试与核验

在源码根目录运行：

```bash
node tests/test_1_2_0_vm.cjs
python3 tests/preflight_1_2_0.py
```

构建 APK 后可核对包内网页资源：

```bash
python3 scripts/verify_apk_assets.py build/shike-android-1.2.0.apk
```

版本 1.2.0 的静态检查、运行时回归和 APK 验证结果保存在 `reference/` 与 `BUILD_VERIFICATION.json` 中。真机启动、相机、系统导出和实际覆盖升级仍需在目标设备上验证。

## 版本管理

- Git 提交记录用于追踪每次源码修改。
- `v1.1.0`、`v1.2.0` 等标签标记正式版本源码快照。
- GitHub Releases 用于发布 APK、完整发布 ZIP 和版本说明。

## 许可证

仓库目前未附带项目级开源许可证。公开可见不等于自动授予复制、修改或再分发许可。应用内嵌的 Lucide 图标遵循其随附许可证，详见 `project/app/src/main/assets/lucide-LICENSE.txt`。
