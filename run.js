delete process.env.ELECTRON_RUN_AS_NODE
const path = require('path')
const { spawn } = require('child_process')
const electronExe = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe')
console.log('spawning', electronExe, 'cwd', __dirname)
const child = spawn(electronExe, ['.', '--enable-logging=stderr', '--no-sandbox'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
})
child.on('exit', (code, sig) => {
  console.log('electron exited code=' + code + ' sig=' + sig)
  process.exit(code ?? 1)
})