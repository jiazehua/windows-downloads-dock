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
- 双击打开文件 / 进入文件夹；**双击空白处返回上一级**
- **Ctrl+C / Ctrl+X / Ctrl+V**：复制、剪切、粘贴文件与文件夹（走系统剪贴板 `CF_HDROP`，
  可以直接粘到资源管理器；剪切带 `Preferred DropEffect=MOVE` 标记，粘贴方执行的是「移动」）。
  剪切后图标变半透明，和资源管理器的观感一致
- **解压压缩包**：右键 `.zip` → 「解压到当前文件夹」，解到同名文件夹；重名时自动加序号
  （`.7z` / `.rar` 等走系统 7-Zip，没装会明确提示）
- 搜索过滤、右键菜单（打开 / 在资源管理器中显示 / 解压 / 剪切 / 复制 / 粘贴 / 复制路径 / 重命名 / 删除到回收站 / 刷新）
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
- **平时任务栏上什么都没有**（只有托盘图标）。按 `Ctrl+Shift+V` 浮层出现时，任务栏才出现它自己的
  按钮；收起后按钮立刻消失，任务栏回到空
- 右键任务栏按钮 → 关闭窗口：只收起浮层，不退出应用（要退出走托盘菜单的「退出」）

## 快捷键与托盘

| 操作 | 效果 |
| --- | --- |
| `Ctrl+Shift+V`（全局） | 在鼠标位置呼出 / 收起 |
| 托盘图标左键 | 呼出 / 收起 |
| 托盘右键 | 启用(Ctrl+Shift+V) / 打开收起 / 固定窗口 / 打开下载·截图·暂存文件夹 / 退出 |
| `Esc` | 收起（右栏有设置或重命名弹窗时先关弹窗） |
| `Ctrl+C` | 复制选中的文件 / 文件夹（可粘到资源管理器等任何程序） |
| `Ctrl+X` | 剪切选中的文件 / 文件夹（图标变半透明；粘贴方执行移动） |
| `Ctrl+V` | 粘贴到当前文件夹（剪贴板是「剪切」则移动，是「复制」则复制；重名自动加「 - 副本N」） |
| 双击文件夹 | 进入该文件夹 |
| 双击空白处 | 返回上一级 |
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
├── cut-helper.ps1         剪切到剪贴板（CF_HDROP + Preferred DropEffect=MOVE）
├── paste-helper.ps1       读剪贴板路径 + 判别复制/剪切，输出 JSON 给主进程
├── extract-helper.ps1     zip 解压（.NET ZipFile + UTF-8→GBK 回退）
├── run.js                 开发态启动 wrapper（清掉 ELECTRON_RUN_AS_NODE）
├── gen-icon.js            图标生成
├── assets/icon.png        512×512 图标
└── _probe/                开发期探针（已 gitignore，不参与打包）
    ├── cdp-eval.js        连 CDP 在真实运行的应用里执行一段 JS（调试主力）
    ├── cdp-shot.js        连 CDP 截图（不含系统边框）
    ├── gesture.js         紧凑「移动鼠标 + 采样窗口尺寸」拖拽回归
    ├── e2e.js             端到端回归（自己 spawn 应用，见下）
    ├── _launch-cdp.js     启动开发版并开 9222 调试端口（做 CDP 实测用）
    ├── _verify-ops.js     CDP 实测左栏文件操作：解压 / 双击空白返回上级 / Ctrl+X / 双击进目录
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

### 2. 所有 `.ps1` 必须存成「UTF-8 带 BOM」（会报「应输入 }」这种莫名其妙的行号）

**这条适用于全部 ps1，不只是 `hook.ps1`。** Windows PowerShell 5.1 在中文系统（ANSI 936）下
按 GBK 解码**无 BOM 的 UTF-8 文件**，中文注释变乱码。多数时候只是注释难看，
但**注释字节被错解后有可能吃掉换行或语句结构，导致随机语法错误、且行号完全指不到真实位置**。

`hook.ps1` 的情况更严重，因为里面还用 here-string 内嵌 C# 再 `Add-Type -TypeDefinition` 编译：

- **脚本文件本身要存成 UTF-8 *带 BOM***；
- **C# here-string 块内必须全英文注释（纯 ASCII）**。因为 `Add-Type -TypeDefinition` 是把源码
  按 `Encoding.Default` 落盘成临时 .cs 再编译的，中文注释在那一步同样会被写坏，
  编译器报错、而且**行号错位**，完全指不到真实位置。

两个都踩过：表现为 `hook exited code=1` 无限重启 + `Add-Type : ...(76) : 应输入 }`。

v2.1.2 又栽了一次：新写的 `cut-helper.ps1` 是无 BOM 的 UTF-8，运行时报
`不能对 Null 值表达式调用方法` —— 指向 `$data.SetFileDropList($sc)`，但 `$data` 明明是刚
`::new()` 出来的。真实原因是文件里的中文注释（含 `⚠️`）被 GBK 错解，把上下文解析坏了。
补上 BOM 后立刻正常。**顺手排查发现 `drag-helper.ps1` / `copy-helper.ps1` / `paste-helper.ps1`
/ `extract-helper.ps1` 也都是无 BOM，已全部统一补上。**

> 检查：`python -c "print(open('x.ps1','rb').read()[:3] == b'\xef\xbb\xbf')"`
> 补 BOM：`python -c "p='x.ps1';r=open(p,'rb').read();open(p,'wb').write(b'\xef\xbb\xbf'+r)"`

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

### 12. 剪贴板的「剪切」不是属性，是一个隐藏格式（`Preferred DropEffect`）

Windows 剪贴板**没有**「这是剪切」这样的布尔属性。复制和剪切在剪贴板上都是 `CF_HDROP`
（一串文件路径），区别只在于有没有附带 **`Preferred DropEffect`** 这个自定义格式：

| 值 | 含义 |
| --- | --- |
| `DROPEFFECT_COPY` = `1` | 复制 |
| `DROPEFFECT_MOVE` = `2` | 剪切（粘贴方执行移动） |

写入时**必须用 `DataObject` 一次性提交两种格式**：

```powershell
$data = [System.Windows.Forms.DataObject]::new()
$data.SetFileDropList($sc)
$data.SetData('Preferred DropEffect', [byte[]](2, 0, 0, 0))
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)   # true = 退出后仍保留
```

先 `SetFileDropList` 再单独补 `SetData` 会把前一步整个冲掉（剪贴板是整体替换语义）。
读取端同理：`GetDataPresent('Preferred DropEffect')` → `ToInt32($eff, 0) -band 2`。

还有个坑：`New-Object System.Windows.Forms.DataObject` 在本项目的无交互会话里**可能建出
`$null`**，随后就报「不能对 Null 值表达式调用方法」。改用 `[System.Windows.Forms.DataObject]::new()`
显式构造就稳了（但先确认文件有 BOM，见第 2 条 —— 两者症状完全相同，别诊断错方向）。

### 13. 任务栏按钮可以「按需出现」：`setSkipTaskbar()` 运行时切换是有效的

用户要的语义是：**平时任务栏空无一人**（只有托盘），按 `Ctrl+Shift+V` 浮层出现时任务栏才有按钮，
收起后按钮消失。早先的判断是「`skipTaskbar` 是创建时标志，运行时切换无效，所以必须搞一个常驻锚点窗口」——
**这个判断是错的**，用对照实验证伪了。

实验：同一次运行里开四个窗口，看谁在任务栏出现按钮。

| 窗口 | 创建时 `skipTaskbar` | 是否 `transparent` | 事后调用 | 任务栏出现？ |
| --- | --- | --- | --- | --- |
| A | `false` | 否 | — | ✅ |
| B | `true` | 否 | `setSkipTaskbar(false)` | ✅ |
| C | `false` | 是 | — | ✅ |
| D | `true` | 是 | `setSkipTaskbar(false)` | ✅ |

**四个全都出现了按钮** → 运行时切换有效，透明与否也不影响。锚点窗口因此被整个移除
（它和「平时任务栏要空」的诉求直接冲突）。

正确顺序（`syncTaskbar()` 的实现）：

- **显示**：`show()` **之后**再 `setSkipTaskbar(false)` —— 顺序反了会让 Windows 建不出按钮
- **收起**：先 `minimize()` / `hide()`，**再** `setSkipTaskbar(true)` —— 先撤标志的话按钮会留着

完整生命周期实测已验证：创建未显示（无按钮）→ 显示中（有按钮，高亮活动）→ 收起后（无按钮）。

> 验证方法：`PIL.ImageGrab` 全屏截图，只裁底部 48px 任务栏带，用 `ImageChops.difference` 比对
> 三个时间点的差异；**要把最右 240px（托盘区）排除**，否则时钟每跳一分钟就产生假差异。

### 14. `Split-Path` 在 PS 5.1 里**没有** `-LiteralPath`（会让解压 100% 失败）

想按字面路径取父目录时，直觉会写：

```powershell
$parent = Split-Path -LiteralPath $dest -Parent   # ✗ PS 5.1 报 AmbiguousParameterSet
```

`Split-Path` 只有 `-Path`（而且是**通配符语义**），`-LiteralPath` 是 `Get-ChildItem` 那一族的
参数。写成这样，PowerShell 会认为你同时给了两个参数集的参数，直接抛：

```
无法使用指定的命名参数解析参数集。
+ FullyQualifiedErrorId : AmbiguousParameterSet
```

后果很隐蔽：脚本**能启动**，行号也指得准，但每一次解压都在同一行失败 —— v2.1.2 发出去的包里
「解压」功能等于完全不可用。正确写法是用 .NET 按字面取：

```powershell
$parent = [System.IO.Path]::GetDirectoryName($dest)   # ✓ 不做通配符解析
```

> 教训：`-LiteralPath` 不存在时，**不要**图省事退回 `-Path`；含 `[ ]` 的路径会被当模式解析。
> 凡是「按字面处理路径」的需求，优先用 `[System.IO.Path]` / `[System.IO.Directory]` 的静态方法。

### 15. 解压要去掉「只有一个顶层目录」的那层壳

很多压缩包的内部结构是「根下只有一个文件夹」：

```
Excel-单元格着色修复.zip
└── Excel/                 ← 包里自带的顶层目录，只是个壳
    ├── index.vue
    └── mixins/...
```

如果直接 `ExtractToDirectory(src, dest)`，会得到 `dest\Excel\index.vue` —— 两层。而用户右键
解压时看到的目标文件夹已经叫 `Excel-单元格着色修复` 了，再套一层 `Excel\` 纯属多余
（对比用户手工解压的 `constraints-powercards-theme-v20-light-simple/`，内容就是直接铺在根的）。

修法是**先解到临时目录、再决定要不要提升**（strip single root）：

1. 临时目录建在目标**同一个父目录**下（`.dd-extract-<8位随机>`）—— 同一分区，
   `Move-Item` / `renameSync` 就是改目录项，秒级完成；跨盘会退化成整树复制，所以位置不能随便放
2. 解完 `Get-ChildItem -Force`，若 **`Count -eq 1` 且 `PSIsContainer`** → 把那一层
   `Move-Item` 成目标目录
3. 否则整个临时目录改名为目标目录 —— **内容仍然全在目标文件夹里，绝不会散落到 Downloads**
4. 任何分支/异常都清掉临时目录，不留 `.dd-extract-*` 垃圾

`.7z / .rar` 等走 7-Zip 的格式在 `main.js` 侧做同样的判定，保证两种路径行为一致。

## 版本

- **v2.1.3（2026-10-10）**：**修掉 v2.1.2 里解压完全用不了的两个 bug**，并给解压加「去壳」。
  - **致命 bug 1**：`extract-helper.ps1` 里写了 `Split-Path -LiteralPath $dest -Parent` ——
    **PS 5.1 的 `Split-Path` 根本没有 `-LiteralPath`**（只有 `-Path`），参数集有歧义，
    任何一次解压都在第 34 行抛 `AmbiguousParameterSet` 直接失败。
    改用 .NET 的 `[System.IO.Path]::GetDirectoryName($dest)` 按字面取父目录（见实现要点 14）。
  - **致命 bug 2（见用户反馈）**：解压会**双层嵌套**。压缩包内部根下只有一个目录时
    （例如 `Excel-单元格着色修复.zip` 里只有 `Excel\index.vue`、`Excel\mixins\...`），
    直接解到目标目录就得到 `Excel-单元格着色修复\Excel\index.vue` —— 多一层没意义的壳；
    用户右键解压时期待的是 `Excel-单元格着色修复\index.vue`。
  - **修法（去壳 / strip single root）**：先解到目标**同盘**的临时目录（`.dd-extract-xxxxxxxx`，
    放同一父目录下保证 `Move-Item` 是秒级改名而不是复制），
    若 `Get-ChildItem -Force` 后**只有 1 个条目且是目录**，就把那一层整体提升为目标目录；
    否则整个临时目录改名为目标（内容仍然都在目标文件夹里，不会散落到 Downloads）。
    标准 zip 走 `extract-helper.ps1`，`.7z/.rar` 等走 7-Zip 后由 `main.js` 做同样的判定。
  - 用户原话：「解压得解压到一个文件夹里，而不是散落在 download 里。」
- **v2.1.2（2026-10-10）**：**任务栏真正做到了「平时什么都没有」**。
  v2.1.1 只把图标从两个减到一个（锚点还常驻），没满足「平时任务栏要空」。
  这一版整个移除锚点窗口（`createAnchor()` / `anchorWin`），改为浮层窗口自己
  `setSkipTaskbar()` 动态进出任务栏 —— 显示时进、收起时撤，并用对照实验证明运行时切换有效
  （见实现要点 13）。顺带修掉一个潜伏很久的编码 bug：**全部 6 个 `.ps1` 统一补 UTF-8 BOM**
  （新写的 `cut-helper.ps1` 正是栽在这上面，见实现要点 2）。

  **左栏新增 4 个文件管理能力**：
  - **解压**：右键 `.zip` → 「解压到当前文件夹」，解到同名文件夹，重名自动加序号
    （`extract-helper.ps1`，走 .NET `ZipFile` 而非 `Expand-Archive` —— 后者没有 `-LiteralPath`，
    含 `[ ]` 的路径会被当通配符；顺带做了 GBK 回退，老工具打的中文 zip 不乱码）
  - **Ctrl+X 剪切**（剪贴板写 `Preferred DropEffect=MOVE`，图标变半透明）
  - **Ctrl+V 粘贴**（读剪贴板标记决定移动还是复制；移动用 `renameSync`，跨盘 `EXDEV` 自动退回
    「复制 + 删源」；源与目标同目录时跳过，不误删）
  - **双击空白处返回上一级**（沿用单击空白那套 150ms 时间窗，避免框选松手被误判成双击空白）
  - 右键菜单同步加了「剪切 / 复制 / 粘贴到当前文件夹 / 解压到当前文件夹」
- **v2.1.1（2026-10-10）**：修复任务栏出现**两个**一模一样、而且关不掉的图标。
  根因是浮层窗口（`popupWin`）和任务栏锚点（`anchorWin`）**都**设了 `skipTaskbar: false`，
  于是各注册了一个任务栏按钮；而浮层的「关闭」被 `close` 事件拦下来只做收起，
  右键「关闭窗口」同样被拦住，看起来就是「关不掉」。这一版把浮层改成动态切换、
  锚点保留 → **只解决了「两个」，没解决「平时要空」，v2.1.2 才彻底做完**。
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
