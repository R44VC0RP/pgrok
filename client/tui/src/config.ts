/**
 * Config loader — reads ~/.pgrok/config and returns validated settings.
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

export interface PgrokConfig {
  host: string
  domain: string
  user: string
  sshKey?: string
}

export function loadConfig(): PgrokConfig {
  const configPath = join(homedir(), ".pgrok", "config")
  if (!existsSync(configPath)) {
    throw new Error(
      `Config not found at ${configPath}. Run setup.sh client first.`
    )
  }

  const content = readFileSync(configPath, "utf-8")
  const vars: Record<string, string> = {}

  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    vars[key] = value
  }

  if (!vars.PGROK_HOST) {
    throw new Error("PGROK_HOST not set in ~/.pgrok/config")
  }
  if (!vars.PGROK_DOMAIN) {
    throw new Error("PGROK_DOMAIN not set in ~/.pgrok/config")
  }

  const sshKey = vars.PGROK_SSH_KEY?.replace(/^~/, homedir())

  return {
    host: vars.PGROK_HOST,
    domain: vars.PGROK_DOMAIN,
    user: vars.PGROK_USER || "pgrok",
    sshKey: sshKey && existsSync(sshKey) ? sshKey : undefined,
  }
}
