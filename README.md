# 下载浮窗 + 最近图片（DownloadsDock × ClipShelf 合并版）

一个常驻托盘的 Windows 浮层工具，`Ctrl+Shift+V` 在**鼠标所在位置**弹出**两个相邻的框**：

```
┌──────────────────────────┐ ┌───────────────────────┐
│  下载浮窗（左）           │ │  最近图片 + 暂存架（右） │
│  · 钉住的下载文件夹       │ │  · 自动收集的剪贴板截图  │
│  · 列表 / 网格两种视图    │ │  · 缩略图网格，悬停预览  │
│  · 多选 / 圈选 / 拖出     │ │  · 暂存架（临时中转站）  │
│  · 搜索 / 右键菜单        │ │  · 置顶 / 设置 / 换目录  │
└──────────────────────────┘ └───────────────────────┘
```

## 功能

**左栏 —— 下载浮窗**
- 钉住 `%USERPROFILE%\Downloads`（可在 `⋯` 菜单改），自动监视刷新
- **列表 / 图标网格**两种视图；网格下 `Ctrl+滚轮` 缩放图标（20~96px，记忆尺寸，默认 44px）
- **多选（Ctrl/Shift 点击）+ 圈选（空白处拖出选框）**，选中后整体拖到微信 / 浏览器 / 资源管理器
- 双击打开文件 / 进入文件夹、搜索过滤、右键菜单（打开 / 在资源管理器中显示 / 复制路径 / 重命名 / 删除到回收站 / 刷新）
- 图片 / 视频 / PDF 走系统缩略图，其余按扩展名缓存系统关联图标
- 拖拽调整左栏宽度（320~900px，记忆）

**右栏 —— 最近图片（ClipShelf）**
- 轮询剪贴板，把复制的图片按 `Screenshot_<时间戳>_<哈希>.png` 落盘并展示
- 只认「图片」，复制文件时不会误存成假截图（走 `clipboard.readImage()` + `CF_HDROP` 判别）
- 一排 3 张缩略图（密排，靠悬停预览看大图）
- **按住卡片拖动可重排顺序**（拖到目标位置松手即可，顺序存进 `config.json` 的 `clipOrder`，
  重启仍在；新截的图仍然排在最前）
- **把卡片拖出浮窗 = 拖到其他应用**（资源管理器 / 微信 / 浏览器…），两种手势靠指针有没有离开窗口自动分流
- 超过保留天数（默认 30 天）自动清理
- 悬停缩略图 → 在窗口旁边弹出**无边框预览小窗**（原图尺寸 + 大小）
- **暂存架**：拖文件进来临时中转（复制 / 剪切 / 粘贴 / 重命名 / 新建文件夹 / 回收站 / 拖出），宽度可拖（280~760px，记忆）

**窗口行为**
- `Ctrl+Shift+V` **跟随鼠标**弹出（多屏下自动出现在鼠标所在那块屏），再按收起
- **默认不置顶**（不选中「固定窗口」）：点别处就自动收回
- 右栏「固定窗口」= 置顶，固定后失焦不收，快捷键只负责叫回来
- 进出场有淡入淡出 + 位移缩放动画；两栏一起动
- **任务栏上只有一个图标**（锚点窗口）。浮层和预览小窗都不进任务栏 —— 只有浮层弹出来时
  不会另外多一个按钮，收起后任务栏就只剩那一个常驻图标 + 托盘图标
- 右键任务栏图标 → 关闭窗口：只收起浮层，不退出应用（要退出走托盘菜单的「退出」）

## 快捷键与托盘

| 操作 | 效果 |
| --- | --- |
| `Ctrl+Shift+V`（全局） | 在鼠标位置呼出 / 收起 |
| 托盘图标左键 | 呼出 / 收起 |
| 托盘右键 | 启用(Ctrl+Shift+V) / 打开收起 / 固定窗口 / 打开下载·截图·暂存文件夹 / 退出 |
| `Esc` | 收起（右栏有设置或重命名弹窗时先关弹窗） |
| 右栏 `✕` | 收起浮层（不退出程序） |

> ⚠️ **`Ctrl+Shift+V` 是被低级键盘钩子全局吞掉的**（连 keyup 一起吞，否则目标程序仍会收到）。
> 也就是说：其它软件里「Ctrl+Shift+V = 无格式粘贴」这个功能会被本工具抢走。
> 不需要时就到托盘右键取消勾选「启用」，钩子会立刻停掉。

## 构建

```powershell
npm install
npm run pack     # 解压版 dist/win-unpacked/DownloadsDock.exe，直接双击测试
npm run dist     # NSIS 单文件安装器 dist/DownloadsDock Setup 2.0.0.exe
```

打包会从国内镜像（`.npmrc` 已配 npmmirror）下载 electron / winCodeSign / nsis，约 3 分钟。
产物含完整 Chromium + Node，体积 ~150MB。安装器默认**一键安装 + 创建桌面快捷方式（叫「下载浮窗」）**。

## 文件结构

```
DownloadsDock-electron/
├── main.js                主进程：窗口 / 定位 / 两栏宽度联动 / 托盘 / 剪贴板轮询 / 全部 IPC
├── preload.js             安全桥接（contextIsolation）：同时暴露 window.dock 与 window.shelf
├── renderer/
│   ├── index.html         双栏结构（#app > #popup + #clipPane）
│   ├── style.css          左栏：深色玻璃风格 + 列表/网格 + #app 进退场动画
│   ├── clip.css           右栏：浅色 ClipShelf 风格（变量统一加 --clip- 前缀）
│   ├── renderer.js        左栏逻辑（整体包在 IIFE 里）
│   ├── clip-app.js        右栏「最近图片」逻辑（整体包在 IIFE 里）
│   ├── shelf-app.js       右栏「暂存架」UI 逻辑
│   ├── preview.html/js    悬停预览小窗（复用同一个 preload.js）
│   └── assets/app.png     右栏占位图标
├── clipshelf/
│   ├── file-shelf.js      暂存架主进程侧：目录树 / 复制粘贴 / 回收站 / 拖拽（通道名 shelf-*）
│   └── shelf-store.js     暂存架文件系统操作（含 AbortSignal、唯一路径）
├── hook.ps1               Ctrl+Shift+V 低级键盘钩子（内嵌 C#，**必须纯 ASCII + UTF-8 BOM**）
├── drag-helper.ps1        目录 / 多文件拖出（WinForms DoDragDrop）
├── copy-helper.ps1        复制到剪贴板（CF_HDROP）
├── paste-helper.ps1       从剪贴板粘贴
├── run.js                 开发态启动 wrapper（清掉 ELECTRON_RUN_AS_NODE）
├── gen-icon.js            图标生成
├── assets/icon.png        512×512 图标
└── _probe/                开发期探针（已 gitignore，不参与打包）
    ├── cdp-eval.js        连 CDP 在真实运行的应用里执行一段 JS（调试主力）
    ├── cdp-shot.js        连 CDP 截图（不含系统边框）
    ├── gesture.js         紧凑「移动鼠标 + 采样窗口尺寸」拖拽回归
    ├── e2e.js             端到端回归（自己 spawn 应用，见下）
    └── ps-input.ps1       合成输入：hotkey / move X Y / pos
```

## 调试与回归（开发期）

前提：主进程带 `--remote-debugging-port=9222` 启动，然后用 `_probe/` 里的探针连上去。
不需要装任何依赖（走 Node 22 内置的 `fetch` + `WebSocket`）。

```powershell
# 在鼠标位置呼出 + 打印两栏尺寸与卡片数
node _probe/cdp-eval.js "JSON.stringify({win:innerWidth,popup:document.getElementById('popup').offsetWidth,clip:document.getElementById('clipPane').offsetWidth})"

# 截图（不含系统边框）
node _probe/cdp-shot.js _probe/shot.png

# 拖拽调整左栏宽度：把光标依次移到 1200 / 1000 / 1150，每次采样窗口宽度
node _probe/gesture.js 1200 1000 1150

# 端到端回归（脚本自己启动应用、自己收尾）
node _probe/e2e.js
```

表达式太长、引号太多时，写进文件用 `CDP_FILE` 传（省掉 shell 转义地狱）：

```powershell
$env:CDP_FILE = "$PWD\_probe\installed-check.expr.js"; node _probe/cdp-eval.js
```

`_probe/installed-check.expr.js`（两栏矩形 / 间隙 / 手柄 / 列表与卡片数 / 暂存架可见性）
和 `_probe/installed-shelf.expr.js`（暂存架开合 → 窗口宽度联动）是给**装好的 release 版**
用的冒烟表达式——打包后最容易丢的就是 asar 里的 `clip-app.js` / `clip.css` / `file-shelf.js`，
这两条跑通基本就说明资源齐了。

卡片重排序有专门的手势探针（用真正的 CDP 输入事件，不是 `dispatchEvent` 合成事件 ——
`setPointerCapture` 只认活跃指针，合成事件会抛 `InvalidPointerId`）：

```powershell
# 把第 1 张拖到第 3 张的位置，断言顺序变了 / 张数不变 / 集合不变
node _probe/reorder-probe.js

# 把卡片拖出窗口，验证仍然切到原生拖拽（会卡在模态循环里，测完直接杀进程看日志）
$env:MODE = 'out'; node _probe/reorder-probe.js
```

结果与崩溃信息都会写进 `%APPDATA%\downloadsdock\error.log`。

> 沙箱/CI 里有三个坑：
> ① **必须加 `--no-sandbox`**。在受限令牌（restricted token / job object）下运行时，
> Chromium 自己的渲染进程沙箱起不来，日志里会是
> `render-process-gone {"reason":"crashed","exitCode":-2147483645}`（`0x80000003` 断点）
> 外加 `child-process-gone {"type":"GPU","exitCode":-1073741819}`（`0xC0000005` 访问冲突），
> 一串刷完进程就没了。**这不是应用缺陷**——同一份二进制加 `--no-sandbox` 稳定常驻，
> 而且只加 `--disable-gpu` 照样崩（说明跟显卡驱动无关，是沙箱层）；
> 用户在自己桌面上双击快捷方式（无参数）不会遇到，因为那里的进程令牌是正常的。
> ② 不能用 `&` 在后台起应用再断言 —— 工具调用一结束后台子进程就被回收，
> 应用会在断言跑到一半时消失，所以 `e2e.js` 自己 `spawn` 应用并全程掌控生命周期；
> ③ 脚本里不要 `spawn powershell.exe`（会被拦），触发热键改用「**双实例**」：
> 再起一个同 `--user-data-dir` 的 Electron，它拿不到单例锁会直接退出，
> 而已在运行的实例会收到 `second-instance` → `togglePopup()`，与真热键走同一条逻辑。

## 实现要点与踩过的坑

### 1. 两个 classic script 共享全局作用域，同名函数会互相覆盖（最隐蔽的一个）

合并后 `renderer/renderer.js` 和 `renderer/clip-app.js` 都是**普通 script**（不是 module），
共用同一个 `window` 作用域。两边顶层都声明了 `function render()` —— 后加载的（右栏）把左栏的
`render()` 悄悄覆盖掉了，于是左栏刷新列表时调用的是右栏那个函数，报
`Cannot read properties of undefined (reading 'shots')`，而且**只在列表刷新时炸**，看着像右栏的 bug。

修法：两个文件整体包进 IIFE（`(function(){...})()` / `(() => {...})()`），不再往 `window` 上挂东西。
**加新文件时同样要包 IIFE。**

### 2. `hook.ps1` 的编码陷阱（会报「应输入 }」这种莫名其妙的行号）

`hook.ps1` 里用 here-string 内嵌 C#，再 `Add-Type -TypeDefinition` 编译。两个必须同时满足：

- **脚本文件本身要存成 UTF-8 *带 BOM***。否则 Windows PowerShell 5.1 在中文系统（ANSI 936）
  下按 GBK 解码无 BOM 的 UTF-8 文件，中文注释直接变乱码；
- **C# here-string 块内必须全英文注释（纯 ASCII）**。因为 `Add-Type -TypeDefinition` 是把源码
  按 `Encoding.Default` 落盘成临时 .cs 再编译的，中文注释在那一步同样会被写坏，
  编译器报错、而且**行号错位**，完全指不到真实位置。

两个都踩过：表现为 `hook exited code=1` 无限重启 + `Add-Type : ...(76) : 应输入 }`。

`_probe/ps-srcprobe.ps1` 就是当时定位这个的探针（复刻落盘 + 单独编译 + 数 0x5C 字节）。

### 3. Windows 会忽略对「已最小化」窗口的 `setPosition`

浮层隐藏走 `minimize()`，而 Windows **直接忽略**对最小化窗口的 `SetWindowPos`，
`restore()` 又会把窗口拉回最小化前的位置。所以定位必须在 `restore()` **之后**：

```js
if (popupWin.isMinimized()) { popupWin.restore(); popupWin.hide() }  // hide() 防在旧位置闪一帧
popupWin.setPosition(x, y, false)
```

写成 `setPosition → restore` 等于没修。另外 `restore()` 会触发 `popupWin.on('restore') → showPopup()`，
所以 `showPopup()` 里必须**先** `popupState = 'showing'` 再 `positionPopup()`，否则重入把浮层又藏起来。

### 4. `resizable: false` 的无边框窗口，`setSize` 会被系统忽略

拖宽期间要临时 `setResizable(true)`，结束再锁回；但临时打开 resizable 会引入一圈不可见的
`WS_THICKFRAME`，**客户区会莫名缩掉 2px**。所以 `applySize()` 里做了「尺寸没变就直接 return」，
免得每次显示都白折腾一遍、两栏比预期窄一点点。

### 5. 拖拽手柄拖的是「下载栏宽度」，不是「窗口宽度」

合并成双栏后 `popupWin.getSize()[0]` 是整窗宽。`begin-resize` 一开始直接拿它当起始宽度，
结果**一起手窗口就爆宽**（实测 `880 → 1152`，一路顶到 MAX_W）。必须减去间隙和右栏：

```js
const winW = popupWin.getSize()[0]
const dockNow = winW - GAP - CLIP_W - (shelfOpen ? shelfWidth : 0)
resizeState = { startX: p.x, startW: clamp(dockNow, MIN_W, MAX_W) }
```

轮询里同理：`w = dockW + GAP + CLIP_W + (shelfOpen ? shelfWidth : 0)`。
`_probe/gesture.js` 就是为这条路径写的回归，断言 `Δ窗口宽 === Δ鼠标位移`（夹取区间内）。

### 6. 收起链条：主进程发起收起时必须等退场动画，但绝不能不兜底

进场动画挂在 `#app` 上（`opacity 0.2s`），退场由渲染层的 `transitionend` 回调
`dock.hideDone()` 通知主进程真正隐藏。旧版主进程发起收起（失焦 / 快捷键 / 焦点轮询）时
**直接 `minimize()`**，`preload` 里暴露的 `onHide('popup-hide')` 和 `hideFallbackTimer`
两个东西从来没被用过 —— 退场动画实际上一次都没播过。

现在的 `hidePopup()`：

```js
popupWin.webContents.send('popup-hide')      // 让渲染层播退场动画
hideFallbackTimer = setTimeout(finish, 260)  // 渲染层若卡住/加载中，到点也必须收起
```

`hide-done` 里先看有没有挂起的 `pendingHide`：有就是「动画播完了」的回执，接着收；
没有就是渲染层自己发起的收起（`✕` 按钮 / `Esc`），走原来的 `dismissPopup()`。
反过来 `doShow()` 要作废挂起的收起，否则在退场那 200ms 内再按快捷键，兜底计时器会把
刚显示出来的窗口又收掉。

### 7. 缩略图缓存 + 主进程耗时埋点

右栏一次最多渲染 60 张截图，`nativeImage.createThumbnailFromPath / toDataURL` 是**同步阻塞**的，
60 张能把主进程卡 ~600ms（实测：按热键后 649ms 浮层才出现）。现在按 `mtimeMs` 缓存
（`shotThumbCache`），并给 `sendState` 加了耗时埋点（>120ms 记 `sendState slow`）。

### 8. 失焦收起要等「真的拿到过焦点」

快捷键是外部 PowerShell 进程吞键后通知主进程弹出的，Windows 有可能拒绝把前台交给一个
「没收到过输入」的进程。那种情况下窗口显示出来了但没有焦点，如果照着 `isFocused() === false`
去收，表现就是**「按了快捷键一闪就没了」**。所以 `startFocusPolling()` 加了 `everFocused` 门：
没拿到过焦点之前不按失焦收起（真·失焦一定会先触发 `blur` 事件，那条路不受影响）。

### 9. `enter-dir` 必须校验路径

渲染层是**从 DOM 的 `dataset` 里取路径**再传给主进程的（`listFiles()` 返回的条目里没有 `path` 字段）。
原来的 `enter-dir` 是裸的 `currentPath = p`，一旦拿到 `undefined` 或已删除的路径，
`currentPath` 就被写成垃圾值，目录列表立刻变空、而且没有任何提示，看起来就像浮窗坏了。

### 10. 剪贴板轮询要区分「图片」和「复制的文件」

复制文件时剪贴板里也有 `CF_HDROP` 等格式，光看「有没有图片」会把文件复制误判成截图存下来。
现在用 `clipboard.readImage()` 取位图，并单独用 `hasFiles()` 判断文件列表，并且只接受
严格匹配 `Screenshot_<8位日期>_<6位时间>_<3位毫秒>_<8位十六进制>.png` 的名字
（`trustedShot()`），避免把任意 png 当截图处理。

### 11. 一个手势要干两件事：卡片拖动既是「重排序」又是「拖到别的应用」

右栏卡片上「按住拖动」本来只有一种含义：拖到微信/资源管理器（`shot-drag` → 原生 `startDrag`）。
加了重排序之后，两种意图共用同一个手势，靠**指针有没有离开浮窗**来分流：
留在窗口内 → 直接 `insertBefore` 实时换位，松手把顺序落盘；越过窗口边界（留 12px 容差抗手抖）
→ 把 DOM 还原成拖动前的样子，改走原生拖拽。

顺带填掉一个**潜伏的 bug**：原来走的是 HTML5 的 `dragstart` → `preventDefault()` → 手动
`startDrag`，可 `preventDefault()` 之后浏览器**不会再派发 `dragend`**，挂在上面的
`dragEnded()` 从来没执行过（`error.log` 里 `drag-ended` 出现 **0 次**），主进程的 `dragging`
一旦置位就永不复位 —— 表现为「拖过一次卡片，浮窗就再也不自动收起了」，只能重启应用。
改成指针事件后这条链路由我们自己掌握。

另外两条实测结论（写代码时最容易想当然的地方）：

- **`webContents.startDrag()` 是模态的**：它跑一个 OS 拖拽循环，**这一行返回时拖拽已经结束**。
  所以复位 `dragging` / 按需收起都写在它返回之后，不需要任何回调。验证方式是让探针把指针
  拖出窗口：日志里出现 `shot drag start` 却始终没有 `shot drag end`，主进程被卡住、调试端口
  也连不上 —— 反证了它是阻塞的。
- 渲染层递上来的顺序**必须白名单过滤**：入参是从 DOM 的 `dataset` 里读回来再传过去的，
  不校验就能把任意路径写进 `config.json` 并长期生效。同时要把「渲染层没见过的更老的文件」
  补在手动顺序之后，否则它们会因为「不在 `clipOrder` 里」而被当成新文件排到最前，
  把用户刚排好的顺序整个挤出 60 张可见范围。

## 版本

- **v2.1.1（2026-10-10）**：修复任务栏出现**两个**一模一样、而且关不掉的图标。
  根因是浮层窗口（`popupWin`）和任务栏锚点（`anchorWin`）**都**设了 `skipTaskbar: false`，
  于是各注册了一个任务栏按钮；而浮层的「关闭」被 `close` 事件拦下来只做收起，
  右键「关闭窗口」同样被拦住，看起来就是「关不掉」。现在浮层改成 `skipTaskbar: true`，
  **只有锚点进任务栏**（常驻那一个），浮层收起后任务栏不再多出任何按钮。
- **v2.1.0（2026-10-09）**：右栏缩略图改**一排 3 个**（更密，靠悬停预览看大图）；
  **卡片支持按住拖动重排序**（顺序落盘在 `config.json` 的 `clipOrder`，新截图仍排最前）；
  左栏图标缩小（网格默认 56→44px，列表 20→16px、行高 40→34px）；
  顺带修复 `dragend` 死接线导致 `dragging` 永不复位的潜伏 bug。
- **v2.0.0（2026-10-09）**：DownloadsDock 与 ClipShelf 合并为单进程单窗口双栏浮层。
  快捷键统一为 `Ctrl+Shift+V`、跟随鼠标弹出、默认不置顶、右栏保留置顶与暂存架。
  修复退场动画链条、拖拽手柄宽度基准、`enter-dir` 路径校验；补全收起/预览/暂存架的日志与
  退出原因埋点（`process exit` / `before-quit` / `will-quit` / `child-process-gone` /
  `window-all-closed` / 单例锁失败）。
- **v1.0.1**：修复多屏下浮层永远固定在同一块屏（`restore() → hide() → setPosition()`）；
  `popup position:` 日志增加 `actual=` 与 `scale=`。
- **v1.0.0**：首个版本。
