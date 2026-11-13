# 食刻 1.2.0 源代码

这是「食刻」Android 1.2.0 的完整应用源码，包名 `app.shike.diet.fixed`，`versionCode=4`。源码包含原生 WebView 外壳、全部 HTML/CSS/JavaScript、图标、离线资源、构建脚本与回归测试。

> 本源码包不包含签名私钥、密码、Android SDK、APK 或编译产物。重新构建时需要自己的签名；新签名不能覆盖升级由此前其他证书签名的安装包。

## 目录

```text
Shike_1.2.0_Source/
├── project/app/src/main/
│   ├── AndroidManifest.xml          # 包名、版本、权限与原生入口
│   ├── java/app/shike/diet/fixed/
│   │   └── MainActivity.java        # WebView、相机/相册、导出与启动诊断
│   ├── assets/
│   │   ├── index.html               # 应用界面和全部业务逻辑
│   │   ├── manifest.json            # PWA 清单
│   │   ├── sw.js                    # 离线缓存
│   │   ├── icons/                   # PWA 图标
│   │   └── lucide-LICENSE.txt       # 内嵌 Lucide 图标许可
│   └── res/                         # Android 应用名、样式与启动图标
├── scripts/
│   ├── build_apk.sh                 # 无 Gradle 的命令行 APK 构建
│   └── verify_apk_assets.py         # APK 与源码 assets 逐字节比对
├── tests/
│   ├── test_1_2_0_vm.cjs            # 15 组确定性运行时回归测试
│   ├── preflight_1_2_0.py           # DOM、图标、版本及数据基线检查
│   └── baselines/index-1.1.0.html   # 1.1.0 回归基线
└── reference/                       # 已交付 1.2.0 APK 的验证资料
```

主要功能代码集中在 `project/app/src/main/assets/index.html`：文字解析、全局食物库、照片预处理与识别候选、USDA 匹配、本地热量计算、四餐汇总、趋势、导入导出和本机持久化。无需 npm 安装前端依赖，Lucide 图标已内嵌。

## 环境与构建

这不是 Gradle 工程，而是使用 `aapt2`、`d8`、`zipalign` 和 `apksigner` 直接构建。需要：

- Bash、Python 3、Node.js 18+、zip/unzip
- JDK 17（`javac`、`keytool`）
- Android SDK Platform `android-35`
- Android SDK Build-Tools `35.0.0`

### 使用现有签名构建

```bash
cd Shike_1.2.0_Source
export ANDROID_SDK_ROOT=/你的路径/Android/Sdk
export SHIKE_KEYSTORE=/你的路径/my-release.jks
export SHIKE_KS_PASS='你的签名密码'
bash scripts/build_apk.sh
```

也可以不设置密码环境变量，改用密码文件：

```bash
export SHIKE_KEYSTORE_PASS_FILE=/你的路径/keystore.pass
bash scripts/build_apk.sh
```

签名别名应为 `shikefixed`。如现有别名不同，请修改 `scripts/build_apk.sh` 中 `apksigner` 的 `--ks-key-alias`。输出位于：

```text
build/shike-android-1.2.0.apk
```

可用 `BUILD_DIR` 改变构建输出目录，用 `ANDROID_BUILD_TOOLS_DIR` 或 `ANDROID_PLATFORM_JAR` 覆盖 SDK 工具位置。

### 仅用于全新安装的本地签名

没有签名时，可显式生成新的本地密钥：

```bash
export ANDROID_SDK_ROOT=/你的路径/Android/Sdk
SHIKE_GENERATE_KEYSTORE=1 bash scripts/build_apk.sh
```

脚本会在 `keystore/` 生成私钥和随机密码文件。请妥善备份且不要公开。

**签名兼容警告：** 新密钥与此前交付 APK 的证书不同，不能覆盖升级原应用。若需保留原应用数据并覆盖升级，必须使用原来的私钥；原私钥未放入公开源码包。不要使用“先卸载再安装”的方式处理签名冲突，卸载会清除本机记录，操作前请先导出备份。

## 测试与核验

在源码根目录执行：

```bash
node tests/test_1_2_0_vm.cjs
python3 tests/preflight_1_2_0.py
```

运行时测试覆盖旧数据、跨餐次/日期复用、食物编辑与删除、图片压缩、双置信度、重量范围与参考物、批量加入与防重复、缺少克重拒绝入账、识别失败保护、USDA 匹配夹具、本地热量重算、CSV 转义及重载持久化。识别和在线响应均为协议测试夹具，**不代表真实食物照片识别准确率**。

构建后检查 APK 中的网页资源是否与当前源码一致：

```bash
python3 scripts/verify_apk_assets.py build/shike-android-1.2.0.apk
```

如需人工检查包信息与签名：

```bash
$ANDROID_SDK_ROOT/build-tools/35.0.0/aapt dump badging build/shike-android-1.2.0.apk
$ANDROID_SDK_ROOT/build-tools/35.0.0/apksigner verify --verbose --print-certs build/shike-android-1.2.0.apk
```

## 数据、服务与精度边界

- 本机存储键保持为 `shike-food-energy-ledger-v1`。卸载或清除应用数据会删除记录，请定期导出 JSON/CSV。
- USDA 在线查询需要网络；源码保留官方 `DEMO_KEY` 回退，正式使用建议申请自己的 API Key。
- 拍照识别需要用户配置兼容 HTTPS 服务并授权上传；未配置或未授权时不会上传，也不会生成虚假食物或热量。
- 单目照片不能保证绝对克重或识别准确率。热量按最终所选食物与用户确认克数在本地重算，不采用识别服务自报热量。
- 原交付包完成了代码、无渲染运行时和签名 APK 包级检查；Android 真机启动、相机、系统导出及实际覆盖升级仍需设备验证。
