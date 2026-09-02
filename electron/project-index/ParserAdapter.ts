import type { ProjectExportKind, ProjectImportKind, ProjectSymbolKind, SymbolLocation } from '../../shared/codeIntelligence'

export interface ParsedSymbol {
  kind: ProjectSymbolKind
  name: string
  qualifiedName: string | null
  scope: string | null
  signature: string | null
  location: SymbolLocation
  exported: boolean
}

export interface ParsedImport {
  specifier: string
  kind: ProjectImportKind
  importedNames: string[]
  location: SymbolLocation
}

export interface ParsedExport {
  name: string
  kind: ProjectExportKind
  targetSpecifier: string | null
  location: SymbolLocation
}

export interface ParsedFile {
  language: string
  parserId: string
  parserVersion: string
  symbols: ParsedSymbol[]
  imports: ParsedImport[]
  exports: ParsedExport[]
}

export interface ParserInput {
  relativePath: string
  content: string
}

export interface ParserAdapter {
  readonly id: string
  readonly version: string
  supports(relativePath: string): boolean
  parse(input: ParserInput): ParsedFile
}

export class ParserRegistry {
  constructor(private readonly adapters: readonly ParserAdapter[]) {}

  find(relativePath: string) {
    return this.adapters.find((adapter) => adapter.supports(relativePath)) ?? null
  }

  parse(adapter: ParserAdapter, input: ParserInput) {
    return adapter.parse(input)
  }
}
