# 下载浮窗 DownloadsDock (Electron 版)

仿 macOS Dock 下载 stack 的 Windows 任务栏工具：
- **任务栏主区域 pin 图标**（打包后右键任务栏图标 → 固定到任务栏）
- **Alt+Shift+D 全局快捷键**呼出/收起浮层（用低级键盘钩子拦截，全局生效）
- **浮层从屏幕底部居中弹出**，带**指向任务栏的小箭头**，**进出场动画**（透明度+位移+缩放，缓动曲线）
- **深色玻璃风格 UI**，圆角、阴影、悬停高亮
- **列表 / 图标网格**两种视图切换（实时）；网格视图 **Ctrl+滚轮 放大/缩小图标**（记忆上次尺寸）
- **多选 + 圈选（框选）**：Ctrl/Shift 点击多选；在列表空白处按住左键拖动出框即可圈选；圈选后可直接拖拽全部到任意应用
- **支持拖拽到任意应用**（单文件走 Electron 原生 startDrag；目录 / 多文件走 PowerShell + WinForms DoDragDrop 通道）
- **双击打开/进入文件夹、搜索过滤、右键菜单（打开/显示/复制路径/重命名/删除到回收站）、文件夹导航、自动监视刷新、图片/视频/PDF 缩略图预览**
- **点别处自动收回**（浮层失焦收起）

## 你需要做的（两件事）

### 1. 在自己 Windows 机器上打包出 exe

本沙盒依赖下载/锁定不稳定，没法替你完成 electron-builder 打包。代码是完整的，你只需：

```powershell
cd DownloadsDock-electron
npm install
npm run pack
```

`npm run pack` 生成 `dist/win-unpacked/DownloadsDock.exe`（解压版，~200MB），可直接双击运行测试。

要打安装器（NSIS 单文件安装）：`npm run dist` → `dist/DownloadsDock Setup 1.0.0.exe`。

> 打包会自动从国内镜像（`.npmrc` 已配 `npmmirror`）下载 electron、winCodeSign、nsis 等，~3 分钟搞定。生成的 exe 含完整 Chromium + Node，体积 ~150MB。

### 2. 固定到任务栏

打包后双击 `DownloadsDock.exe`，然后：
- 在**任务栏上的图标**上右键 → **「固定到任务栏」**
- 之后点任务栏图标即可呼出/收起浮层

## 日常使用

| 操作 | 效果 |
| --- | --- |
| `Alt+Shift+D`（全局，任意前台都能用） | 呼出/收起浮层 |
| 点击任务栏图标 | 呼出浮层 |
| 托盘图标（任务栏 `^` 展开区） | 左键呼出；右键：启用/禁用、退出 |
| 浮层顶栏 `网格` / `列表` | 切换视图（记忆选择） |
| 网格视图下 `Ctrl+滚轮` | 放大/缩小图标（20~96px，记忆上次尺寸） |
| 空白处按住左键拖动 | **圈选（框选）**多个文件/文件夹 |
| `Ctrl`/`Shift` + 点击 | 多选 |
| 双击文件 / 文件夹 | 打开 / 进入 |
| 拖拽文件 | 选中后拖到微信 / 浏览器 / 资源管理器任意地方（支持圈选多文件） |
| 右键文件 | 打开 / 在资源管理器中显示 / 复制路径 / 重命名 / **删除（回收站）** / 刷新 |
| 浮层顶栏 `⋯` | 更改钉住的文件夹、开机自启、退出 |
| 点别处 / `Esc` | 自动收回 |

## 钉的文件夹默认

`%USERPROFILE%\Downloads`，可在 `⋯` 菜单改。配置存 `%APPDATA%/downloadsdock/config.json`。

## 文件结构

```
DownloadsDock-electron/
├── main.js              主进程（窗口/任务栏锚点/文件操作/拖拽协调/IPC）
├── preload.js           安全桥接（contextIsolation）
├── renderer/
│   ├── index.html       浮层结构
│   ├── style.css        深色玻璃风格 + 动画 + 列表/网格
│   └── renderer.js      渲染逻辑
├── hook.ps1             Win+W 低级键盘钩子（内嵌 C#）
├── drag-helper.ps1      多文件拖拽辅助（WinForms DoDragDrop）
├── gen-icon.js          图标生成脚本
├── assets/icon.svg      应用图标（macOS 风格蓝渐变下载箭头）
├── assets/icon.png      512×512 图标（electron-builder 自动转 ico）
├── run.js               开发态启动 wrapper（删除 ELECTRON_RUN_AS_NODE 环境变量）
├── test-multimonitor.js 多屏定位回归测试（见下）
├── package.json         含 electron-builder 配置（appId、win、nsis）
└── .npmrc               npmmirror 国内镜像加速
```

## 多屏定位回归测试

`test-multimonitor.js` 会加载真实的 `main.js`，把「鼠标位置」替换成受控值，依次模拟在三块屏上
`隐藏(minimize) → 弹出`，然后断言窗口的**实际**坐标是否等于该屏 workArea 底部居中的期望坐标。

```powershell
# 跑当前 main.js
node_modules\electron\dist\electron.exe test-multimonitor.js --no-sandbox

# 对照旧版本（应复现 bug：第 2、3 块屏 FAIL）
$env:DD_SRC='main.js.bak-20261009'; node_modules\electron\dist\electron.exe test-multimonitor.js --no-sandbox
```

结果写到 `<仓库>/_probe/e2e-result.txt`。注意终端里若注入了 `ELECTRON_RUN_AS_NODE=1`，electron 会退化成纯 Node，需先清空。

## 实现细节要点

- **任务栏 pin**：用了"任务栏锚点窗口"技巧——一个 1×1 透明窗口（`skipTaskbar:false`）做任务栏按钮；点击它会 focus，主进程收到 focus 事件 toggle 浮层。
- **Win+W 抢过小组件**：`hook.ps1` 用 `WH_KEYBOARD_LL` 低级钩子，检测 `Win+W` 时 `return 1` 吞掉事件，Win11 小组件收不到。
- **多文件拖出**：单文件走 Electron `webContents.startDrag`（顺滑无延迟）；目录/多文件走一次性 `drag-helper.ps1` 用 `WinForms.DataObject(FileDrop, paths)` + `DoDragDrop`，已验证可用。
- **图标**：实时用 Electron `app.getFileIcon(path, {size:'large'})` 拿系统真实关联图标，按扩展名缓存，列表/网格两视图共用。
- **动画**：CSS `transition: opacity + transform` 带 `cubic-bezier(0.2,0.8,0.25,1)` 缓动；进场 fade+slide+scale，出场反向，`transitionend` 后通知主进程 hide。
- **多屏定位（重要坑）**：浮层要出现在**鼠标当前所在的那块屏**上（`screen.getCursorScreenPoint()` → `screen.getDisplayNearestPoint()` → 该屏 `workArea` 底部居中）。但 Windows 会**直接忽略对「已最小化」窗口的 `SetWindowPos`**，而浮层隐藏走的是 `minimize()`，所以 `positionPopup()` 里**必须先 `restore()` 再 `setPosition()`**：
  ```js
  if (popupWin.isMinimized()) { popupWin.restore(); popupWin.hide() }  // hide() 防止在旧位置闪一帧
  popupWin.setPosition(x, y, false)
  ```
  写成 `setPosition → restore` 的话，`restore()` 会把窗口又拉回最小化前的位置，等于没修；只 `hide()` 不 `restore()` 也无效。另外 `restore()` 会触发窗口的 `'restore'` 事件回调（`popupWin.on('restore') → showPopup()`），所以 `showPopup()` 里 **`popupState = 'showing'` 必须提到 `positionPopup()` 之前**，否则会重入 showPopup，把刚弹出的浮层又藏起来。

## 已知细节

- `npm start`（开发态）走 `run.js` wrapper（删除 `ELECTRON_RUN_AS_NODE=1` 环境变量，沙盒里某些 IDE 注入这个会让 electron 退化成纯 Node 模式）。打包后的 exe 不受影响。
- 下载目录文件非常多时（几千个）首屏渲染有几百毫秒延迟，已做按扩展名图标缓存。
- 任务栏图标可右键结束任务栏固定 / 关闭，浮层内 `⋯ → 退出` 完全退出。

## 启动"没反应"排查指南（重要）

**双击后先看两处：**
1. **任务栏**：程序启动后任务栏会出现一个 DownloadsDock 图标（1×1 透明锚点窗口占位）；新版启动约 1 秒后**浮层会自动弹出**（屏幕底部中央，带向下箭头）——看到浮层 = 启动成功。
2. **进程**：任务管理器里应有多个 `DownloadsDock.exe`（Electron 多进程，主+GPU+渲染，正常）。

**常见原因：**
- **已在运行**：程序是单实例。第一次双击启动后（浮层可能被点掉），再双击或点任务栏图标 → 恢复/收起浮层。如果完全没反应，先看任务管理器有没有 DownloadsDock.exe 进程，有的话右键结束全部再重新双击。
- **启动即退出（进程闪没）**：看错误日志 `%APPDATA%\downloadsdock\error.log`（新版本会把崩溃堆栈写进去），把内容发我。
- **从终端启动报 `bad option` / `ELECTRON_RUN_AS_NODE`**：说明终端环境注入了该变量（某些 IDE / 工具链会）。**用资源管理器双击 exe 不受影响**；终端里请用 `set ELECTRON_RUN_AS_NODE=` 清空后再运行。

**新版（v1.1.0）改动：**
- 启动后自动弹出浮层（一眼看到效果，之前是"静默启动"导致以为没反应）
- 全进程崩溃日志（error.log）
- 修复打包后 `hook.ps1` / `drag-helper.ps1` 被压进 asar 导致 Win+W 钩子和多文件拖拽失效的问题（asarUnpack + 路径修正）

**v1.0.1 改动（2026-10-09）：**
- **修复多屏下浮层永远固定在同一块屏的问题**。原 `positionPopup()` 在窗口处于最小化状态时调用 `setPosition()`，被 Windows 忽略，`restore()` 又把窗口拉回原位；于是首次弹出后位置就"焊死"了。现改为 `restore() → hide() → setPosition()`。
- `error.log` 的 `popup position:` 行增加 `actual=` 与 `scale=`，可直接看到**期望坐标 vs 实际坐标**是否一致，便于以后再排查定位问题。