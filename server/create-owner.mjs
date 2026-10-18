import readline from 'node:readline'
import { initSchema, pool } from './db.mjs'
import { bootstrapOwner } from './auth.mjs'

if (!process.stdin.isTTY) throw new Error('Run this command in an interactive terminal.')
const username = process.argv[2]
if (!username) throw new Error('Usage: npm run owner:create -- USERNAME')

function hiddenPassword(prompt) {
  return new Promise(resolve => {
    process.stdout.write(prompt)
    readline.emitKeypressEvents(process.stdin)
    process.stdin.setRawMode(true)
    let value = ''
    const handle = (character, key) => {
      if (key?.name === 'return') {
        process.stdin.off('keypress', handle)
        process.stdin.setRawMode(false)
        process.stdout.write('\n')
        resolve(value)
      } else if (key?.ctrl && key.name === 'c') process.exit(130)
      else if (key?.name === 'backspace') value = value.slice(0, -1)
      else if (character && !key?.ctrl) value += character
    }
    process.stdin.on('keypress', handle)
  })
}

try {
  const password = await hiddenPassword('Owner password (12+ characters): ')
  await initSchema()
  const user = await bootstrapOwner(username, password)
  console.log(`Created owner ${user.username}.`)
} finally { await pool.end() }
