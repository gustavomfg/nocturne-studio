import path from 'node:path'
import ts from 'typescript'
import type { ProjectSymbolKind, SymbolLocation } from '../../shared/codeIntelligence'
import type { ParsedExport, ParsedFile, ParsedImport, ParsedSymbol, ParserAdapter, ParserInput } from './ParserAdapter'

const SUPPORTED_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])
const PARSER_VERSION = ts.versionMajorMinor

export class TypeScriptParserAdapter implements ParserAdapter {
  readonly id = 'typescript'
  readonly version = PARSER_VERSION

  supports(relativePath: string) {
    return SUPPORTED_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
  }

  parse(input: ParserInput): ParsedFile {
    const extension = path.extname(input.relativePath).toLowerCase()
    const sourceFile = ts.createSourceFile(
      input.relativePath,
      input.content,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(extension),
    )
    const symbols: ParsedSymbol[] = []
    const imports: ParsedImport[] = []
    const exports: ParsedExport[] = []

    const visit = (node: ts.Node) => {
      const symbol = symbolForNode(node, sourceFile, input.content)
      if (symbol) symbols.push(symbol)
      const imported = importsForNode(node, sourceFile)
      if (imported) imports.push(imported)
      imports.push(...requireImportsForNode(node, sourceFile))
      exports.push(...exportsForNode(node, sourceFile))
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)

    return {
      language: extension === '.tsx' || extension === '.jsx' ? 'TypeScript/JSX' : extension === '.ts' || extension === '.mts' || extension === '.cts' ? 'TypeScript' : 'JavaScript',
      parserId: this.id,
      parserVersion: this.version,
      symbols: deduplicateSymbols(symbols),
      imports: deduplicateImports(imports),
      exports: deduplicateExports(exports),
    }
  }
}

function scriptKindFor(extension: string) {
  if (extension === '.tsx') return ts.ScriptKind.TSX
  if (extension === '.jsx') return ts.ScriptKind.JSX
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function symbolForNode(node: ts.Node, sourceFile: ts.SourceFile, source: string): ParsedSymbol | null {
  let kind: ProjectSymbolKind | null = null
  let name: string | null = null
  let component = false
  if (ts.isFunctionDeclaration(node)) {
    kind = 'function'
    name = node.name?.text ?? null
    component = isComponentName(name) && containsJsx(node)
  } else if (ts.isClassDeclaration(node)) {
    kind = 'class'
    name = node.name?.text ?? null
  } else if (ts.isInterfaceDeclaration(node)) {
    kind = 'interface'
    name = node.name.text
  } else if (ts.isTypeAliasDeclaration(node)) {
    kind = 'type'
    name = node.name.text
  } else if (ts.isEnumDeclaration(node)) {
    kind = 'enum'
    name = node.name.text
  } else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    kind = 'method'
    name = propertyName(node.name)
  } else if (ts.isVariableDeclaration(node)) {
    kind = 'variable'
    name = ts.isIdentifier(node.name) ? node.name.text : null
    component = isComponentName(name) && containsJsx(node.initializer)
  } else if (ts.isModuleDeclaration(node)) {
    kind = 'namespace'
    name = propertyName(node.name)
  }
  if (!kind || !name) return null
  if (component) kind = 'component'
  const scope = scopeForNode(node)
  const location = locationFor(node, sourceFile)
  return {
    kind,
    name,
    qualifiedName: scope ? `${scope}.${name}` : name,
    scope,
    signature: signatureForNode(node, source),
    location,
    exported: hasExportModifier(node),
  }
}

function hasExportModifier(node: ts.Node) {
  if (hasModifier(node, ts.SyntaxKind.ExportKeyword) || hasModifier(node, ts.SyntaxKind.DefaultKeyword)) return true
  if (!ts.isVariableDeclaration(node)) return false
  const statement = node.parent.parent
  return ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)
}

function importsForNode(node: ts.Node, sourceFile: ts.SourceFile): ParsedImport | null {
  if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return null
  const clause = node.importClause
  if (!clause) return { specifier: node.moduleSpecifier.text, kind: 'side-effect', importedNames: [], location: locationFor(node, sourceFile) }
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    return { specifier: node.moduleSpecifier.text, kind: 'namespace', importedNames: [clause.namedBindings.name.text], location: locationFor(node, sourceFile) }
  }
  const names: string[] = []
  if (clause.name) names.push('default')
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const item of clause.namedBindings.elements) names.push((item.propertyName ?? item.name).text)
  }
  return { specifier: node.moduleSpecifier.text, kind: names.length === 1 && names[0] === 'default' ? 'default' : 'named', importedNames: names, location: locationFor(node, sourceFile) }
}

function requireImportsForNode(node: ts.Node, sourceFile: ts.SourceFile): ParsedImport[] {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'require') return dynamicImportForNode(node, sourceFile)
  const argument = node.arguments[0]
  if (!argument || !ts.isStringLiteral(argument)) return []
  return [{ specifier: argument.text, kind: 'require', importedNames: [], location: locationFor(node, sourceFile) }]
}

function dynamicImportForNode(node: ts.Node, sourceFile: ts.SourceFile): ParsedImport[] {
  if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) return []
  const argument = node.arguments[0]
  if (!argument || !ts.isStringLiteral(argument)) return []
  return [{ specifier: argument.text, kind: 'dynamic', importedNames: [], location: locationFor(node, sourceFile) }]
}

function exportsForNode(node: ts.Node, sourceFile: ts.SourceFile): ParsedExport[] {
  if (ts.isExportDeclaration(node)) {
    const targetSpecifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null
    if (!node.exportClause) return [{ name: '*', kind: 'all', targetSpecifier, location: locationFor(node, sourceFile) }]
    if (ts.isNamedExports(node.exportClause)) return node.exportClause.elements.map((item) => ({
      name: (item.name ?? item.propertyName).text,
      kind: targetSpecifier ? 're-export' as const : 'named' as const,
      targetSpecifier,
      location: locationFor(item, sourceFile),
    }))
  }
  if (ts.isExportAssignment(node)) return [{ name: 'default', kind: 'default', targetSpecifier: null, location: locationFor(node, sourceFile) }]
  if (isDeclarationExport(node)) {
    const name = declarationName(node)
    if (name) return [{ name, kind: hasModifier(node, ts.SyntaxKind.DefaultKeyword) ? 'default' : 'named', targetSpecifier: null, location: locationFor(node, sourceFile) }]
  }
  return []
}

function isDeclarationExport(node: ts.Node) {
  return (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isVariableStatement(node)
    || ts.isModuleDeclaration(node)) && hasModifier(node, ts.SyntaxKind.ExportKeyword)
}

function declarationName(node: ts.Node) {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.map((item) => ts.isIdentifier(item.name) ? item.name.text : '').filter(Boolean).join(', ')
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) return propertyName(node.name)
  return null
}

function propertyName(name: ts.PropertyName | ts.ModuleName | undefined): string | null {
  if (!name) return null
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return null
}

function scopeForNode(node: ts.Node) {
  const parts: string[] = []
  let parent = node.parent
  while (parent && !ts.isSourceFile(parent)) {
    const name = ts.isClassLike(parent) ? parent.name?.text : ts.isFunctionLike(parent) && parent.name ? propertyName(parent.name) : ts.isModuleDeclaration(parent) ? propertyName(parent.name) : null
    if (name) parts.unshift(name)
    parent = parent.parent
  }
  return parts.length ? parts.join('.') : null
}

function signatureForNode(node: ts.Node, source: string) {
  const text = node.getText()
  const bodyStart = text.search(/\s*[{=]\s*/)
  const signature = bodyStart > 0 ? text.slice(0, bodyStart) : text
  return signature.replace(/\s+/g, ' ').trim().slice(0, 1_000) || source.slice(node.getStart(), Math.min(node.getEnd(), node.getStart() + 1_000)).replace(/\s+/g, ' ').trim()
}

function containsJsx(node: ts.Node | undefined): boolean {
  if (!node) return false
  let found = false
  const visit = (child: ts.Node) => {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) found = true
    if (!found) ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

function isComponentName(name: string | null) {
  return Boolean(name && /^[A-Z]/.test(name))
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind) {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind))
}

function locationFor(node: ts.Node, sourceFile: ts.SourceFile): SymbolLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd())
  return { startLine: start.line + 1, startColumn: start.character + 1, endLine: end.line + 1, endColumn: end.character + 1 }
}

function deduplicateSymbols(symbols: ParsedSymbol[]) {
  return uniqueBy(symbols, (symbol) => `${symbol.kind}:${symbol.name}:${symbol.location.startLine}:${symbol.location.startColumn}`)
}

function deduplicateImports(imports: ParsedImport[]) {
  return uniqueBy(imports, (item) => `${item.kind}:${item.specifier}:${item.location.startLine}:${item.location.startColumn}`)
}

function deduplicateExports(exports: ParsedExport[]) {
  return uniqueBy(exports, (item) => `${item.kind}:${item.name}:${item.targetSpecifier ?? ''}:${item.location.startLine}:${item.location.startColumn}`)
}

function uniqueBy<T>(values: T[], keyFor: (value: T) => string) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = keyFor(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
