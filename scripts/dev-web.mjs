import { spawn } from 'node:child_process'

const processes = []
const node = process.execPath
function launch(command, args) {
  const child = spawn(command, args, { stdio: 'inherit', env: process.env })
  processes.push(child)
  child.on('exit', code => {
    if (code && code !== 0) process.exitCode = code
    for (const other of processes) if (other !== child && !other.killed) other.kill()
  })
}
launch(node, ['server/start.mjs'])
launch(node, ['node_modules/vite/bin/vite.js'])
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const child of processes) child.kill(signal) })
