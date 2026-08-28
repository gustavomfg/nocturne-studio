import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'

const roots = [
  'src/index.css',
  'src/styles/components.css',
  'src/styles/product-constraints.css',
  'src/domains/agent/agent.css',
  'src/domains/settings/settings.css',
  'src/domains/suggestions/suggestions.css',
  'src/domains/memory/memory.css',
]
const files = []
const seenFiles = new Set()

function collectCss(file) {
  const normalized = path.normalize(file)
  if (seenFiles.has(normalized) || !fs.existsSync(normalized)) return
  seenFiles.add(normalized)
  files.push(normalized)
  const source = fs.readFileSync(normalized, 'utf8')
  for (const match of source.matchAll(/@import\s+["']([^"']+\.css)["']/g)) {
    collectCss(path.resolve(path.dirname(normalized), match[1]))
  }
}

roots.forEach(collectCss)
const allowedBreakpoints = new Set([520, 720, 980, 981, 1120, 1320])
const failures = []

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(/@media\s*\([^)]*(?:min-|max-)?width\s*(?::|[<>]?=)\s*(\d+)px[^)]*\)/g)) {
    const width = Number(match[1])
    if (!allowedBreakpoints.has(width)) failures.push(`${file}: breakpoint não canônico de ${width}px`)
  }
  for (const match of source.matchAll(/font(?:-size)?\s*:\s*(\d+(?:\.\d+)?)px/g)) {
    const size = Number(match[1])
    if (size < 13) failures.push(`${file}: tipografia de ${size}px abaixo do piso de 13px`)
  }
  const root = postcss.parse(source, { from: file })
  auditShadowedDeclarations(root, file)
  auditInteractionPatterns(root, file)
}

function auditInteractionPatterns(container, file) {
  for (const node of container.nodes ?? []) {
    if (node.type === 'atrule') auditInteractionPatterns(node, file)
    if (node.type !== 'rule') continue
    for (const declaration of node.nodes ?? []) {
      if (declaration.type !== 'decl') continue
      if ((declaration.prop === 'border-left' || declaration.prop === 'border-right') && /(^|\s)(?:[2-9]|\d{2,})px\b/.test(declaration.value) && !node.selector.includes('checkbox')) {
        failures.push(`${file}:${declaration.source.start.line}: faixas laterais coloridas devem usar borda completa ou indicador semântico (${node.selector})`)
      }
      if (declaration.prop.startsWith('transition') && /\b(width|height|padding|margin|top|right|bottom|left|flex-basis)\b/.test(declaration.value)) {
        failures.push(`${file}:${declaration.source.start.line}: transição de layout pode causar reflow (${node.selector})`)
      }
    }
  }
}

function auditShadowedDeclarations(container, file) {
  const selectors = new Map()
  for (const node of container.nodes ?? []) {
    if (node.type === 'rule') selectors.set(node.selector, [...(selectors.get(node.selector) ?? []), node])
    if (node.type === 'atrule') auditShadowedDeclarations(node, file)
  }
  for (const [selector, rules] of selectors) {
    const seen = new Map()
    for (const rule of [...rules].reverse()) {
      for (const declaration of [...rule.nodes].reverse()) {
        if (declaration.type !== 'decl') continue
        const later = seen.get(declaration.prop)
        if (later && (!declaration.important || later.important)) failures.push(`${file}:${declaration.source.start.line}: ${declaration.prop} é sobrescrita por uma regra posterior idêntica (${selector})`)
        else if (!later || declaration.important) seen.set(declaration.prop, declaration)
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log('Design system consistente: tipografia >= 13px, breakpoints canônicos e nenhuma declaração idêntica sombreada.')
}
