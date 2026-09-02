import crypto from 'node:crypto'
import path from 'node:path'
import type { ProjectExport, ProjectImport, ProjectIndexFile } from '../../shared/codeIntelligence'
import type { ParsedExport, ParsedImport } from './ParserAdapter'

const RESOLUTION_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.json']

export interface RelationResolutionInput {
  workspace: string
  sourcePath: string
  sourceHash: string
  imports: ParsedImport[]
  exports: ParsedExport[]
  files: ReadonlyMap<string, ProjectIndexFile>
}

export function resolveRelations(input: RelationResolutionInput) {
  return {
    imports: input.imports.map((relation, index) => resolveImport(input, relation, index)),
    exports: input.exports.map((relation, index) => resolveExport(input, relation, index)),
  }
}

function resolveImport(input: RelationResolutionInput, relation: ParsedImport, index: number): ProjectImport {
  const target = resolveLocalTarget(input.sourcePath, relation.specifier, input.files)
  const resolution = target ? 'local' : isRelativeSpecifier(relation.specifier) ? 'unresolved' : 'external'
  return {
    id: stableRelationId('import', input.sourcePath, input.sourceHash, relation.specifier, relation.location.startLine, index),
    workspace: input.workspace,
    sourcePath: input.sourcePath,
    sourceHash: input.sourceHash,
    specifier: relation.specifier,
    targetPath: target?.relativePath ?? null,
    targetHash: target?.analyzedHash ?? null,
    kind: relation.kind,
    importedNames: relation.importedNames,
    location: relation.location,
    resolution,
  }
}

function resolveExport(input: RelationResolutionInput, relation: ParsedExport, index: number): ProjectExport {
  const target = relation.targetSpecifier ? resolveLocalTarget(input.sourcePath, relation.targetSpecifier, input.files) : null
  return {
    id: stableRelationId('export', input.sourcePath, input.sourceHash, `${relation.name}:${relation.targetSpecifier ?? ''}`, relation.location.startLine, index),
    workspace: input.workspace,
    sourcePath: input.sourcePath,
    sourceHash: input.sourceHash,
    name: relation.name,
    kind: relation.kind,
    targetPath: target?.relativePath ?? null,
    targetHash: target?.analyzedHash ?? null,
    location: relation.location,
  }
}

function resolveLocalTarget(sourcePath: string, specifier: string, files: ReadonlyMap<string, ProjectIndexFile>) {
  if (!isRelativeSpecifier(specifier)) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier)).replace(/^\.\//, '')
  if (base === '..' || base.startsWith('../')) return null
  for (const suffix of RESOLUTION_EXTENSIONS) {
    const candidate = `${base}${suffix}`
    const file = files.get(candidate)
    if (file) return file
  }
  for (const suffix of RESOLUTION_EXTENSIONS.slice(1)) {
    const candidate = `${base}/index${suffix}`
    const file = files.get(candidate)
    if (file) return file
  }
  return null
}

function isRelativeSpecifier(specifier: string) {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../')
}

function stableRelationId(kind: string, sourcePath: string, sourceHash: string, value: string, line: number, index: number) {
  return `${kind}-${crypto.createHash('sha256').update(`${sourcePath}\0${sourceHash}\0${value}\0${line}\0${index}`).digest('hex').slice(0, 32)}`
}
