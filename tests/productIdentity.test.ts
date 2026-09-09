import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import packageMetadata from '../package.json'
import productIdentity from '../shared/product-identity.json'

describe('stable product identity', () => {
  it('keeps runtime and package names aligned with the canonical contract', () => {
    expect(packageMetadata.name).toBe(productIdentity.packageName)
    expect(packageMetadata.desktopName).toBe(productIdentity.displayName)

    const main = fs.readFileSync(path.join(process.cwd(), 'electron/main.ts'), 'utf8')
    const codex = fs.readFileSync(path.join(process.cwd(), 'electron/codex/CodexClient.ts'), 'utf8')
    expect(main).toContain("import productIdentity from '../shared/product-identity.json'")
    expect(main).toContain('productIdentity.currentUserDataDirectory')
    expect(codex).toContain('name: productIdentity.codexClientName')
    expect(codex).toContain('title: productIdentity.displayName')
  })

  it('freezes distribution identifiers required for upgrades', () => {
    const builder = fs.readFileSync(path.join(process.cwd(), 'electron-builder.json5'), 'utf8')
    expect(builder).toContain(`"appId": "${productIdentity.applicationId}"`)
    expect(builder).toContain(`"productName": "${productIdentity.displayName}"`)
    expect(builder).toContain(`"repo": "${productIdentity.repository}"`)
    expect(productIdentity.repository).toBe('nocturne-studio')
    expect(builder).not.toContain('"repo": "Nocturne-Codex"')
  })

  it('keeps the authenticated runner label synchronized', () => {
    const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/codex-contract-smoke.yml'), 'utf8')
    expect(workflow).toContain(`runs-on: [self-hosted, ${productIdentity.runnerLabel}]`)
  })
})
