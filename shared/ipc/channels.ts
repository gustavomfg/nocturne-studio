export const IPC_CHANNELS = {
  workspace: { select: 'workspace:select', validate: 'workspace:validate', list: 'workspaces:list', remove: 'workspaces:remove', favorite: 'workspaces:favorite', openTool: 'workspace:openTool', watch: 'workspace:watch', changed: 'workspace:changed' },
  projectIndex: { status: 'projectIndex:status', start: 'projectIndex:start', cancel: 'projectIndex:cancel', retry: 'projectIndex:retry', summary: 'projectIndex:summary', files: 'projectIndex:files', symbols: 'projectIndex:symbols', imports: 'projectIndex:imports', exports: 'projectIndex:exports', stack: 'projectIndex:stack', exclusions: 'projectIndex:exclusions', changed: 'projectIndex:statusChanged' },
  validation: { run: 'validation:run', cancel: 'validation:cancel', list: 'validation:list', latest: 'validation:latest', changed: 'validation:statusChanged' },
  conversations: { list: 'conversations:list', page: 'conversations:page', create: 'conversations:create', messages: 'conversations:messages', messagePage: 'conversations:messagePage', delete: 'conversations:delete' },
  ai: { send: 'ai:send', cancel: 'ai:cancel', event: 'ai:event', saveAssistant: 'ai:save-assistant', approve: 'ai:approve', status: 'ai:status', rollbackStatus: 'ai:rollbackStatus', rollback: 'ai:rollback' },
  codex: { status: 'codex:accountStatus', login: 'codex:login', logout: 'codex:logout', models: 'codex:models' },
  files: { attach: 'files:attach', open: 'files:open', preview: 'files:preview' },
  memory: { get: 'memory:get', set: 'memory:set' },
  brain: { page: 'brain:page', history: 'brain:history', create: 'brain:create', update: 'brain:update', delete: 'brain:delete', extract: 'brain:extract' },
  artifacts: { list: 'artifacts:list', page: 'artifacts:page', delete: 'artifacts:delete' },
  suggestions: { list: 'suggestions:list', page: 'suggestions:page', create: 'suggestions:create', status: 'suggestions:status' },
  data: { export: 'data:export', import: 'data:import' },
  diagnostics: { openLogs: 'diagnostics:openLogs', copy: 'diagnostics:copy', export: 'diagnostics:export', rendererError: 'diagnostics:rendererError', rendererStats: 'diagnostics:rendererStats' },
  settings: { get: 'settings:get', set: 'settings:set' },
  providers: { list: 'providers:list', create: 'providers:create', update: 'providers:update', remove: 'providers:remove', testConnection: 'providers:testConnection', diagnose: 'providers:diagnose' },
  models: { list: 'models:list', refresh: 'models:refresh', bindings: 'models:bindings', setBindings: 'models:setBindings' },
  git: { status: 'git:status', commit: 'git:commit' },
  documents: { prepareMarkdown: 'documents:prepareMarkdown', applyMarkdown: 'documents:applyMarkdown', export: 'documents:export' },
  clipboard: { readText: 'clipboard:readText', writeText: 'clipboard:writeText' },
} as const

export type IpcChannel = {
  [Group in keyof typeof IPC_CHANNELS]:
    (typeof IPC_CHANNELS)[Group][keyof (typeof IPC_CHANNELS)[Group]]
}[keyof typeof IPC_CHANNELS]
