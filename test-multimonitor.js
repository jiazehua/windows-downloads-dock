// 端到端测试：加载改过的真实 main.js，反复 隐藏(minimize) → 切换目标屏 → 弹出，检查窗口实际落点。
// screen 模块必须先等 app ready 才能访问，所以补丁放在 whenReady 里面。
const { app } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '_probe')
try { fs.mkdirSync(OUT, { recursive: true }) } catch (e) {}
const out = []
const say = (m) => { out.push(m); console.log(m) }

app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})

// 加载被测的真实 main.js，并把内部函数暴露出来
// 只改测试副本：把光标来源换成可控的 fakeCursor（不改动真实源码文件）
const rawSrc = fs.readFileSync(path.join(__dirname, process.env.DD_SRC || 'main.js'), 'utf8')
global.__fakeCursor = null
global.__fakeCursorFn = () => global.__fakeCursor || { x: -99999, y: -99999 }
const patchedCount = (rawSrc.match(/screen\.getCursorScreenPoint\(\)/g) || []).length
const src = rawSrc.replace(/screen\.getCursorScreenPoint\(\)/g, 'global.__fakeCursorFn()')
  + '\n;module.exports = { showPopup, hidePopup, getState: () => ({ popupState, popupWin }) };\n'
const m = new module.constructor()
m.paths = module.paths
m._compile(src, path.join(__dirname, 'main.js'))
const api = m.exports

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let fakeCursor = null

app.whenReady().then(async () => {
  const { screen } = require('electron')
  say('已替换光标调用点数量 = ' + patchedCount + ' （positionPopup 里应为 1）')

  await sleep(1200)   // 等 main.js 自己的 ready 流程 + 启动自动弹出跑完

  const displays = screen.getAllDisplays()
  say('displays: ' + displays.map(d => `${d.id}@${d.bounds.x},${d.bounds.y} ${d.bounds.width}x${d.bounds.height}`).join(' | '))

  const logFile = path.join(app.getPath('userData'), 'error.log')
  const readLogs = () => { try { return fs.readFileSync(logFile, 'utf8') } catch (e) { return '' } }

  let pass = 0, fail = 0
  for (let i = 0; i < displays.length; i++) {
    const d = displays[i]
    fakeCursor = { x: d.bounds.x + Math.round(d.bounds.width / 2), y: d.bounds.y + Math.round(d.bounds.height / 2) }
    global.__fakeCursor = fakeCursor

    const w = api.getState().popupWin
    if (!w || w.isDestroyed()) { say('窗口不存在，跳过'); break }

    // 1) 以程序真实的隐藏方式隐藏（blur / 快捷键路径 → minimize）
    api.hidePopup('e2e-test')
    await sleep(450)
    const hid = { min: w.isMinimized(), vis: w.isVisible() }

    // 2) 弹出 —— 应落在 fakeCursor 所在的那块屏
    const lenBefore = readLogs().length
    api.showPopup()
    await sleep(700)

    const posLines = readLogs().slice(lenBefore).split('\n').filter(l => l.includes('popup position'))
    const p = w.getPosition()
    const W = w.getSize()[0]
    const expX = d.workArea.x + Math.round((d.workArea.width - W) / 2)
    const expY = d.workArea.y + d.workArea.height - 628 - 6
    const ok = p[0] === expX && p[1] === expY
    ok ? pass++ : fail++

    say(`\n[屏${i + 1} id=${d.id}] workArea=${JSON.stringify(d.workArea)} 窗口宽=${W}`)
    say(`  隐藏后: minimized=${hid.min} visible=${hid.vis}`)
    say(`  期望=${expX},${expY}   实际=${p[0]},${p[1]}   ${ok ? 'PASS' : 'FAIL'}`)
    say(`  窗口可见=${w.isVisible()}  popupState=${api.getState().popupState}  定位调用次数=${posLines.length}${posLines.length === 1 ? ' (正常)' : ' (异常：疑似重入)'}`)
    if (posLines.length) say(`  日志: ${posLines.join(' || ')}`)
  }

  say(`\n=== 结果: ${pass} PASS / ${fail} FAIL ===`)
  fs.writeFileSync(OUT + '/e2e-result.txt', out.join('\n'), 'utf8')
  app.exit(0)
})

setTimeout(() => { try { fs.writeFileSync(OUT + '/e2e-result.txt', out.concat(['[TIMEOUT]']).join('\n'), 'utf8') } catch (e) {} app.exit(1) }, 40000)
