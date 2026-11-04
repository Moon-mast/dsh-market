/**
 * Desktop packaging contract for this fork.
 *
 * DSH Desktop owns `$DSH_HOME/profiles/desktop` and installs plugins through
 * its own plugin manager. A git install of this repository must therefore be
 * usable without running package build scripts: the built runtime, the client
 * bundle and the bundle patch all have to be present in the checkout.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  files: string[]
  scripts: Record<string, string>
  dsh: { compatibility?: { profiles?: string[] } }
}

describe('DSH Desktop packaging', () => {
  it('declares both the web and desktop profiles', () => {
    expect(manifest.dsh.compatibility?.profiles).toEqual(['web', 'desktop'])
  })

  it('ships the built runtime instead of building during a git install', () => {
    expect(existsSync(resolve('lib/index.js'))).toBe(true)
    expect(manifest.files).toContain('lib')
    expect(manifest.scripts.prepare).toBeUndefined()
  })
})
