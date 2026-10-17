import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
export const VERSION = process.env.APP_VERSION || pkg.version
export const BUILD = process.env.APP_BUILD || ''
export const COMMIT = (process.env.APP_COMMIT || '').slice(0, 7)
