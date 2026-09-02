import path from 'node:path'

/** Directories that are never traversed by workspace discovery or the native watcher. */
export const WORKSPACE_IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'release',
  'out',
  'coverage',
])

export const PROJECT_DISCOVERY_IGNORED_DIRECTORIES = new Set([
  ...WORKSPACE_IGNORED_DIRECTORIES,
  '.nocturne',
  '.next',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.pytest_cache',
  '.venv',
  'target',
  'build',
])

export function relativeWorkspacePath(workspace: string, candidate: string) {
  const root = path.resolve(workspace)
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(root, candidate)
  const relative = path.relative(root, resolved).replace(/\\/g, '/')
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return null
  return relative
}

export function isIgnoredWorkspaceRelativePath(relative: string) {
  return WORKSPACE_IGNORED_DIRECTORIES.has(relative.split('/')[0] ?? '')
}

export function isIgnoredWorkspacePath(workspace: string, candidate: string) {
  const relative = relativeWorkspacePath(workspace, candidate)
  return relative ? isIgnoredWorkspaceRelativePath(relative) : false
}

export function isIgnoredProjectDiscoveryRelativePath(relative: string) {
  return PROJECT_DISCOVERY_IGNORED_DIRECTORIES.has(relative.split('/')[0] ?? '')
}
