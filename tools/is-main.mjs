import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// True when this module is the entry point (node path/to/this.mjs), resolving
// symlinks on argv[1] because import.meta.url resolves them and argv[1] does not.
export function isMain(metaUrl) {
  return process.argv[1] != null && metaUrl === pathToFileURL(realpathSync(process.argv[1])).href
}
