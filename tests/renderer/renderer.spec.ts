import { expect, test } from '@playwright/test'
import { installNocturneMock } from './mockNocturne'
import type { Suggestion } from '../../src/types'
import { RENDERER_LIMITS } from '../../shared/constants'

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

test.describe('renderer do produto', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-07-13T20:05:00.000Z'))
    await installNocturneMock(page)
  })

  test('expõe o atalho do workspace para o WebStorm', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await expect(page.getByRole('button', { name: 'Abrir no WebStorm' })).toBeVisible()
  })

  test('permite selecionar English e mantém a preferência após reabrir configurações', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.getByRole('button', { name: 'Abrir configurações' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Configurações' })
    await dialog.getByRole('button', { name: 'Aplicativo' }).click()
    await dialog.getByLabel('Idioma').selectOption('en')
    await dialog.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('button', { name: 'New conversation' })).toBeVisible()
    await page.getByRole('button', { name: 'Open settings' }).first().click()
    const englishDialog = page.getByRole('dialog', { name: 'Settings' })
    await englishDialog.getByRole('button', { name: 'Application' }).click()
    await expect(englishDialog.getByLabel('Language')).toHaveValue('en')
    await englishDialog.getByLabel('Language').selectOption('pt-BR')
    await englishDialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
    await expect(page.getByRole('button', { name: 'Nova conversa' })).toBeVisible()
  })

  test('publica somente métricas agregadas de desempenho', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    const reports = await page.evaluate(() => (
      window as unknown as {
        __nocturneTest: { performanceReports(): Array<Record<string, unknown>> }
      }
    ).__nocturneTest.performanceReports())
    expect(reports.length).toBeGreaterThan(0)
    expect(reports[reports.length - 1]).toEqual({
      responseSize: expect.any(Number),
      activities: expect.any(Number),
      messages: expect.any(Number),
      startupMs: expect.any(Number),
      conversationLoadMs: expect.any(Number),
      longTasks: expect.any(Number),
      longTaskDurationMs: expect.any(Number),
      longestLongTaskMs: expect.any(Number),
    })
  })

  test('mantém somente um painel modal e restaura o foco', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await expect(page.locator('#workspace-sidebar')).toHaveClass(/open/)
    await expect(page.locator('#agent-inspector')).toHaveClass(/open/)

    await page.setViewportSize({ width: 980, height: 820 })
    await expect(page.locator('#workspace-sidebar')).toHaveClass(/open/)
    await expect(page.locator('#agent-inspector')).toHaveClass(/closed/)
    await expect(page.locator('.panel-backdrop')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Recolher barra lateral' })).toBeFocused()

    await page.keyboard.press('Escape')
    const sidebarTrigger = page.getByRole('button', { name: 'Abrir barra lateral' })
    await expect(sidebarTrigger).toBeFocused()
    await expect(sidebarTrigger).toHaveAttribute('aria-expanded', 'false')

    const inspectorTrigger = page.getByRole('button', { name: 'Mostrar painel do agente' })
    await inspectorTrigger.click()
    await expect(page.locator('#workspace-sidebar')).toHaveClass(/collapsed/)
    await expect(page.locator('#agent-inspector')).toHaveClass(/open/)
    await expect(page.locator('.panel-backdrop')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Ocultar painel do agente' })).toHaveCount(0)
    await expect(page.locator('#agent-inspector').getByRole('button', { name: 'Fechar painel do agente' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Mostrar painel do agente' })).toBeFocused()
  })

  test('prende a tabulação no painel compacto', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 800 })
    await ready(page)
    await page.getByRole('button', { name: 'Abrir barra lateral' }).click()
    const first = page.getByRole('button', { name: 'Recolher barra lateral' })
    const last = page.locator('#workspace-sidebar').getByRole('button', { name: 'Abrir configurações' })
    await expect(first).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(last).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(first).toBeFocused()
  })

  test('faz o composer crescer até o limite e restaura a altura', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 850 })
    await ready(page)
    const composer = page.locator('#prompt-composer')
    const initialHeight = await composer.evaluate((element) => element.getBoundingClientRect().height)
    await composer.fill(Array.from({ length: 8 }, (_, index) => `Linha ${index + 1} com uma instrução detalhada.`).join('\n'))
    const expandedHeight = await composer.evaluate((element) => element.getBoundingClientRect().height)
    expect(expandedHeight).toBeGreaterThan(initialHeight)
    expect(expandedHeight).toBeLessThanOrEqual(220)
    await composer.fill(Array.from({ length: 40 }, (_, index) => `Linha extensa ${index + 1}.`).join('\n'))
    await expect(composer).toHaveCSS('overflow-y', 'auto')
    await composer.fill('')
    await expect(composer).toHaveCSS('overflow-y', 'hidden')
    expect(await composer.evaluate((element) => element.getBoundingClientRect().height)).toBe(initialHeight)
  })

  test('mantém um símbolo textual do estado Codex em 520px', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 760 })
    await ready(page)
    const connection = page.locator('.connection')
    await expect(connection.locator('.connection-symbol')).toBeVisible()
    await page.evaluate(() => (window as unknown as { __nocturneTest: { emitStatus(payload: unknown): void } }).__nocturneTest.emitStatus({ status: 'ready' }))
    await expect(connection.locator('.connection-symbol')).toHaveAttribute('data-symbol', 'ready')
    await page.evaluate(() => (window as unknown as { __nocturneTest: { emitStatus(payload: unknown): void } }).__nocturneTest.emitStatus({ status: 'failed' }))
    await expect(connection.locator('.connection-symbol')).toHaveAttribute('data-symbol', 'unavailable')
  })

  test('expõe streaming, erro e aprovação pendente sem deslocar controles essenciais', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.evaluate(() => {
      const bridge = (window as unknown as { __nocturneTest: { emitEvent(payload: unknown): void; emitStatus(payload: unknown): void } }).__nocturneTest
      bridge.emitStatus({ status: 'streaming' })
      bridge.emitEvent({ method: 'item/agentMessage/delta', params: { delta: 'Analisando a experiência em tempo real…' } })
      bridge.emitEvent({ method: 'item/commandExecution/requestApproval', params: { approvalKey: 'approval-1', command: 'npm test' } })
      bridge.emitEvent({ method: 'warning', params: { message: 'Validação visual pendente.' } })
      bridge.emitEvent({ method: 'error', params: { message: 'Falha simulada do renderer.' } })
    })
    await expect(page.getByText('Analisando a experiência em tempo real…')).toBeVisible()
    await expect(page.getByText('Decisões pendentes')).toBeVisible()
    await page.getByRole('button', { name: 'Ver detalhes técnicos' }).click()
    await expect(page.getByText('Validação visual pendente.')).toBeVisible()
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Falha simulada do renderer.')
    await expect(alert).toContainText('Preservado:')
    await expect(alert).toContainText('Como resolver:')
    await expect(page.locator('.composer')).toBeVisible()
  })

  test('permite repetir uma execução após erro recuperável', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 850 })
    await ready(page)
    await page.evaluate(() => {
      let calls = 0
      window.nocturne.ai.send = async () => {
        calls += 1
        ;(window as unknown as { __retryCalls: number }).__retryCalls = calls
        if (calls === 1) throw new Error('O Provider excedeu o tempo permitido.')
      }
    })
    await page.locator('.conversation-open').click()
    await page.getByLabel('Mensagem para o agente').fill('Tente uma operação recuperável.')
    await page.getByRole('button', { name: 'Enviar mensagem' }).click()
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('A operação excedeu o tempo limite')
    await alert.getByRole('button', { name: 'Tentar novamente' }).click()
    await expect(alert).toBeHidden()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __retryCalls: number }).__retryCalls)).toBe(2)
  })

  test('recupera uma conclusão já persistida após reinicialização do renderer', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 850 })
    await ready(page)
    await page.evaluate(() => {
      const bridge = (window as unknown as { __nocturneTest: { emitEvent(payload: unknown): void } }).__nocturneTest
      bridge.emitEvent({
        method: 'turn/completed',
        params: {
          conversationId: 'conversation-1',
          turn: { id: 'turn-recovered', status: 'completed' },
          persistedMessage: { id: 'message-recovered', conversationId: 'conversation-1', role: 'assistant', content: 'Resposta recuperada do processo principal.', metadata: null, createdAt: '2026-07-13T20:05:00.000Z' },
        },
      })
    })
    await expect(page.getByText('Resposta recuperada do processo principal.')).toBeVisible()
  })

  test('mantém o acionador do inspector fora do painel quando a conversa passa a rolar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 760 })
    await ready(page)
    const trigger = page.getByRole('button', { name: 'Ocultar painel do agente' })
    const inspector = page.locator('#agent-inspector')
    const actions = page.locator('.top-actions')
    await expect(inspector).toHaveClass(/open/)
    await page.waitForTimeout(300)
    const before = await trigger.boundingBox()

    await page.evaluate(() => {
      const bridge = (window as unknown as { __nocturneTest: { emitEvent(payload: unknown): void; emitStatus(payload: unknown): void } }).__nocturneTest
      bridge.emitStatus({ status: 'waiting-approval' })
      bridge.emitEvent({ method: 'item/agentMessage/delta', params: { delta: 'Conteúdo em andamento.\n'.repeat(2_000) } })
    })

    await expect.poll(() => page.locator('.chat-scroll').evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    const [after, actionsBox, inspectorBox] = await Promise.all([trigger.boundingBox(), actions.boundingBox(), inspector.boundingBox()])
    expect(before).not.toBeNull()
    expect(after).not.toBeNull()
    expect(actionsBox).not.toBeNull()
    expect(inspectorBox).not.toBeNull()
    expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(1)
    expect((after?.x ?? 0) + (after?.width ?? 0)).toBeLessThanOrEqual((actionsBox?.x ?? 0) + (actionsBox?.width ?? 0))
    expect((actionsBox?.x ?? 0) + (actionsBox?.width ?? 0)).toBeLessThanOrEqual(inspectorBox?.x ?? 0)
    expect((after?.x ?? 0) + (after?.width ?? 0)).toBeLessThan(inspectorBox?.x ?? 0)
  })

  test('mantém streaming e diffs extensos com DOM limitado', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.evaluate(() => {
      const bridge = (window as unknown as { __nocturneTest: { emitEvent(payload: unknown): void } }).__nocturneTest
      bridge.emitEvent({ method: 'item/agentMessage/delta', params: { delta: '# Resposta em andamento\n' + 'texto '.repeat(20_000) } })
      bridge.emitEvent({ method: 'turn/diff/updated', params: { diff: '+linha alterada\n'.repeat(30_000) } })
    })
    await expect(page.locator('.streaming-response')).toHaveCount(1)
    await expect(page.locator('.streaming-response').locator('h1')).toHaveCount(0)
    const proposed = page.getByText('Alterações propostas', { exact: true })
    await expect(proposed).toBeVisible()
    await expect(page.locator('.diff-panel')).toHaveCount(0)
    await proposed.click()
    await expect(page.locator('.diff-panel pre')).toHaveCount(1)
    expect(await page.locator('.diff-panel pre').textContent()).toHaveLength(300_000)
    await expect(page.locator('.diff-panel pre span')).toHaveCount(0)
  })

  test('mantém o DOM do chat limitado em um histórico com milhares de mensagens', async ({ page }) => {
    await installNocturneMock(page, { messageCount: 2_000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 1180, height: 850 })
    await ready(page)

    const scroller = page.locator('.chat-scroll')
    const entries = page.locator('.message-entry')
    const loadOlder = page.getByRole('button', { name: 'Carregar mensagens anteriores' })
    await expect(entries).toHaveCount(100)
    await scroller.evaluate((element) => { element.scrollTop = 0 })
    const anchor = page.locator('[data-message-id="message-1901"] .user-row')
    const anchorBefore = await anchor.boundingBox()

    await loadOlder.click()
    await expect(page.getByText('Mensagem histórica 1801', { exact: true })).toBeVisible()
    expect(anchorBefore).not.toBeNull()
    await expect.poll(async () => {
      const anchorAfter = await anchor.boundingBox()
      return Math.abs((anchorAfter?.y ?? 0) - (anchorBefore?.y ?? 0))
    }).toBeLessThan(3)

    for (const firstMessage of [1701, 1601, 1501, 1401, 1301, 1201, 1101]) {
      await scroller.evaluate((element) => { element.scrollTop = 0 })
      await loadOlder.click()
      await expect(page.getByText(`Mensagem histórica ${firstMessage}`, { exact: true })).toBeVisible()
      expect(await entries.count()).toBeLessThanOrEqual(RENDERER_LIMITS.chatMessages)
    }

    const loadLatest = page.getByRole('button', { name: 'Voltar às mensagens mais recentes' })
    await expect(loadLatest).toBeVisible()
    await loadLatest.click()
    await expect(page.getByText('Mensagem histórica 2000', { exact: true })).toBeVisible()
    await expect(entries).toHaveCount(100)
  })

  test('protege configurações editadas e fecha o diálogo com Escape', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.getByRole('button', { name: 'Abrir configurações' }).last().click()
    await expect(page.getByRole('dialog', { name: 'Configurações' })).toBeVisible()
    await page.getByRole('button', { name: 'Aplicativo' }).click()
    const checkbox = page.getByRole('checkbox', { name: /Logs detalhados/ })
    await checkbox.click()
    await expect(checkbox).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(page.getByText('Descartar alterações?')).toBeVisible()
    await page.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(checkbox).toBeChecked()
  })

  test('mantém a navegação das configurações estável no hover', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.getByRole('button', { name: 'Abrir configurações' }).last().click()
    const dialog = page.getByRole('dialog', { name: 'Configurações' })
    const navigation = dialog.getByRole('navigation', { name: 'Seções das configurações' })
    const codex = navigation.getByRole('button', { name: /^IA/ })
    const workspaces = navigation.getByRole('button', { name: /Workspaces/ })
    await codex.click()
    const before = await Promise.all([codex.boundingBox(), workspaces.boundingBox()])
    await workspaces.hover()
    await page.waitForTimeout(180)
    const after = await Promise.all([codex.boundingBox(), workspaces.boundingBox()])
    expect(before.every(Boolean) && after.every(Boolean)).toBe(true)
    expect(after.map((box) => ({ width: box?.width, height: box?.height }))).toEqual(
      before.map((box) => ({ width: box?.width, height: box?.height })),
    )
    expect((after[1]?.y ?? 0) - (after[0]?.y ?? 0)).toBe((before[1]?.y ?? 0) - (before[0]?.y ?? 0))
    await expect(workspaces).toHaveCSS('transform', 'none')
    await codex.hover(); await workspaces.hover(); await codex.hover(); await workspaces.hover()
    await expect(workspaces).toHaveCSS('transform', 'none')
    await page.waitForTimeout(240)
    await expect(dialog.locator('p').filter({ hasText: 'Conectar inteligência' })).toBeVisible()
    await dialog.evaluate((element) => {
      element.scrollTo(0, 0)
      element.querySelectorAll<HTMLElement>('*').forEach((child) => child.scrollTo(0, 0))
    })
    await expect(dialog).toHaveScreenshot('settings-dialog.png', { animations: 'disabled', caret: 'hide' })
  })

  test('mantém o controle de logs detalhados estável no hover e no clique', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.getByRole('button', { name: 'Abrir configurações' }).last().click()
    const dialog = page.getByRole('dialog', { name: 'Configurações' })
    await dialog.getByRole('button', { name: /Aplicativo/ }).click()
    const checkbox = dialog.getByRole('checkbox', { name: /Logs detalhados/ })
    const card = checkbox.locator('..')
    const before = await card.boundingBox()
    await card.hover(); await checkbox.hover(); await card.hover(); await checkbox.hover()
    await page.waitForTimeout(240)
    const afterHover = await card.boundingBox()
    expect(before).not.toBeNull()
    expect(afterHover).toMatchObject({ width: before?.width, height: before?.height })
    await expect(card).toHaveCSS('transform', 'none')
    await expect(checkbox).toHaveCSS('appearance', 'none')
    await expect(checkbox).toHaveCSS('width', '18px')
    await checkbox.click()
    await expect(checkbox).toBeChecked()
    const afterClick = await card.boundingBox()
    expect(afterClick).toMatchObject({ width: before?.width, height: before?.height })
  })

  test('trunca nomes e caminhos longos sem atravessar os limites da interface', async ({ page }) => {
    await page.setViewportSize({ width: 980, height: 820 })
    await ready(page)
    await page.locator('.title-block h1').evaluate((element) => { element.textContent = 'LimpadorEAnalisadorDeArmazenamentoComUmNomeExtremamenteLongo' })
    await page.locator('.path-pill span').evaluate((element) => { element.textContent = 'LimpadorEAnalisadorDeArmazenamentoComUmNomeExtremamenteLongo' })
    const titleBlock = page.locator('.title-block')
    const actions = page.locator('.top-actions')
    const titleBox = await titleBlock.boundingBox()
    const actionsBox = await actions.boundingBox()
    expect(titleBox).not.toBeNull()
    expect(actionsBox).not.toBeNull()
    expect((titleBox?.x ?? 0) + (titleBox?.width ?? 0)).toBeLessThanOrEqual(actionsBox?.x ?? 0)

    await page.getByRole('button', { name: 'Abrir configurações' }).last().click()
    const dialog = page.getByRole('dialog', { name: 'Configurações' })
    await dialog.getByRole('button', { name: /Workspaces/ }).click()
    const card = dialog.locator('.settings-workspaces > div').first()
    const name = card.locator('strong')
    const path = card.locator('small')
    await name.evaluate((element) => { element.textContent = 'LimpadorEAnalisadorDeArmazenamentoComUmNomeExtremamenteLongo' })
    await path.evaluate((element) => { element.textContent = '/home/usuario/Documentos/Projetos/LimpadorEAnalisadorDeArmazenamentoComUmNomeExtremamenteLongo' })
    await expect(name).toHaveCSS('text-overflow', 'ellipsis')
    await expect(path).toHaveCSS('text-overflow', 'ellipsis')
    const [cardBox, nameBox, pathBox] = await Promise.all([card.boundingBox(), name.boundingBox(), path.boundingBox()])
    expect(cardBox).not.toBeNull()
    expect((nameBox?.x ?? 0) + (nameBox?.width ?? 0)).toBeLessThanOrEqual((cardBox?.x ?? 0) + (cardBox?.width ?? 0))
    expect((pathBox?.x ?? 0) + (pathBox?.width ?? 0)).toBeLessThanOrEqual((cardBox?.x ?? 0) + (cardBox?.width ?? 0))
  })

  test('mantém falhas de salvamento dentro do diálogo de configurações', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.evaluate(() => { window.nocturne.settings.set = async () => { throw new Error('Não foi possível salvar as configurações.') } })
    await page.getByRole('button', { name: 'Abrir configurações' }).last().click()
    await page.getByRole('button', { name: 'Aplicativo' }).click()
    await page.getByRole('checkbox', { name: /Logs detalhados/ }).click()
    await page.getByRole('button', { name: 'Salvar alterações' }).click()
    const dialog = page.getByRole('dialog', { name: 'Configurações' })
    await expect(dialog.getByRole('alert')).toContainText('Não foi possível salvar as configurações.')
    await expect(dialog).toBeVisible()
  })

  test('expõe exportação e restauração na área de diagnóstico', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.getByRole('button', { name: 'Abrir configurações' }).last().click()
    const dialog = page.getByRole('dialog', { name: 'Configurações' })
    await dialog.getByRole('button', { name: 'Diagnóstico' }).click()
    await expect(dialog.getByRole('button', { name: 'Exportar diagnóstico' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Exportar diagnóstico' }).click()
    await expect(page.locator('.product-toast')).toContainText('Diagnóstico sanitizado exportado.')
    await expect(dialog.getByRole('button', { name: 'Exportar dados' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Restaurar backup' })).toBeVisible()
  })

  test('ativa uma conexão por API explicitamente no workspace', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.getByRole('button', { name: 'Abrir configurações' }).last().click()
    const dialog = page.getByRole('dialog', { name: 'Configurações' })
    await expect(dialog.getByRole('heading', { name: 'IA', exact: true })).toBeVisible()
    await expect(dialog.locator('p').filter({ hasText: 'Conectar inteligência' })).toBeVisible()

    await dialog.getByRole('button', { name: 'Adicionar conta, API ou modelo local' }).click()
    await expect(dialog.getByText('Escolher acesso')).toBeVisible()
    await dialog.getByRole('button', { name: 'OpenRouter' }).click()
    await dialog.getByRole('textbox', { name: '' }).fill('sk-or-v1-test')
    await dialog.getByRole('button', { name: 'Conectar' }).click()
    await expect(dialog.getByText('Escolher modelo')).toBeVisible()
    await expect(dialog.getByText('Claude Sonnet')).toBeVisible()

    await dialog.getByRole('button', { name: 'Usar este modelo' }).click()
    await expect(page.locator('.product-toast')).toContainText('Usando anthropic/claude-sonnet.')
    await expect(dialog.getByText('Conectar IA')).toBeVisible()
    await expect(dialog.getByText('OpenRouter', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Diagnosticar OpenRouter' }).click()
    const diagnostic = dialog.locator('.provider-diagnostic')
    await expect(diagnostic.getByText('OpenAI-compatible v1')).toBeVisible()
    await expect(diagnostic.getByText('42 ms')).toBeVisible()
    await expect(diagnostic.getByText('Compatível', { exact: true })).toBeVisible()
  })

  test('lista e seleciona modelos disponíveis pela conta ChatGPT', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.getByRole('button', { name: 'Abrir configurações' }).last().click()
    const dialog = page.getByRole('dialog', { name: 'Configurações' })

    await dialog.getByRole('button', { name: 'Escolher modelo da conta ChatGPT' }).click()
    await expect(dialog.getByText('Modelo da conta ChatGPT')).toBeVisible()
    await expect(dialog.getByRole('button', { name: /GPT-5.6 Sol/ })).toBeVisible()
    await dialog.getByRole('button', { name: /GPT-5.6 Luna/ }).click()
    await dialog.getByRole('button', { name: 'Usar este modelo' }).click()

    await expect(page.locator('.product-toast')).toContainText('Usando GPT-5.6 Luna pela conta ChatGPT.')
    await expect(dialog.getByText(/gpt-5\.6-luna/)).toBeVisible()
  })

  test('gerencia conexões por API com credencial transitória e estados explícitos', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.getByRole('button', { name: 'Abrir configurações' }).last().click()
    const dialog = page.getByRole('dialog', { name: 'Configurações' })
    await expect(dialog.getByText('Conectar IA')).toBeVisible()
    await dialog.getByRole('button', { name: 'Adicionar conta, API ou modelo local' }).click()
    await expect(dialog.getByText('Escolher acesso')).toBeVisible()

    await dialog.getByRole('button', { name: 'OpenRouter' }).click()
    const secret = dialog.getByRole('textbox', { name: '' })
    await secret.fill('temporary-renderer-secret')

    await dialog.getByRole('button', { name: 'Conectar' }).click()
    await expect(dialog.getByText('Escolher modelo')).toBeVisible()
    await expect(dialog.getByText('Claude Sonnet')).toBeVisible()

    await dialog.getByRole('button', { name: 'Usar este modelo' }).click()
    await expect(dialog.getByText('Conectar IA')).toBeVisible()
    await expect(dialog.getByText('OpenRouter', { exact: true })).toBeVisible()

    await dialog.getByRole('button', { name: 'Remover OpenRouter' }).click()
    await expect(dialog.getByText('Remover esta conexão?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Remover', exact: true }).click()
    await expect(dialog.getByText('Conectar IA')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Remover OpenRouter' })).toHaveCount(0)
    await expect(page.locator('.product-toast')).toContainText('Conexão removida.')
  })

  test('não confirma um modelo de API sem workspace ativo', async ({ page }) => {
    await installNocturneMock(page, { empty: true })
    await page.reload()
    await ready(page)
    await page.getByRole('button', { name: 'Abrir configurações' }).last().click()
    const dialog = page.getByRole('dialog', { name: 'Configurações' })
    await dialog.getByRole('button', { name: 'Adicionar conta, API ou modelo local' }).click()
    await dialog.getByRole('button', { name: 'OpenRouter' }).click()
    await dialog.getByRole('textbox', { name: '' }).fill('temporary-renderer-secret')
    await dialog.getByRole('button', { name: 'Conectar' }).click()

    await expect(dialog.getByText('Selecione um workspace para ativar o modelo.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Usar este modelo' })).toBeDisabled()
    await expect(page.locator('.product-toast')).toHaveCount(0)
  })

  test('protege alterações não salvas nas configurações', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 800 })
    await ready(page)
    await page.getByRole('button', { name: 'Abrir configurações' }).last().click()
    const dialog = page.getByRole('dialog', { name: 'Configurações' })
    await dialog.getByRole('button', { name: 'Aplicativo' }).click()
    await dialog.getByText('Logs detalhados').click()
    await page.keyboard.press('Escape')
    await expect(dialog.getByRole('alert')).toContainText('Descartar alterações?')
    await dialog.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(dialog.getByText('Logs detalhados')).toBeVisible()
  })

  test('protege e salva o contexto do workspace com feedback', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.getByRole('button', { name: 'Memória do workspace' }).click()
    const memory = page.getByRole('dialog', { name: 'Contexto do workspace' })
    await memory.getByLabel('Memória e decisões').fill('Decisão importante para o projeto.')
    await page.keyboard.press('Escape')
    await expect(memory.getByRole('alert')).toContainText('Descartar alterações?')
    await memory.getByRole('button', { name: 'Continuar editando' }).click()
    await memory.getByRole('button', { name: 'Salvar contexto' }).click()
    await expect(memory).toBeHidden()
    await expect(page.locator('.product-toast')).toContainText('Contexto do workspace salvo.')
  })

  test('mantém falhas de memória dentro do diálogo', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.evaluate(() => { window.nocturne.memory.set = async () => { throw new Error('Não foi possível salvar o contexto.') } })
    await page.getByRole('button', { name: 'Memória do workspace' }).click()
    const memory = page.getByRole('dialog', { name: 'Contexto do workspace' })
    await memory.getByLabel('Regras e padrões').fill('Sempre validar o pacote.')
    await memory.getByRole('button', { name: 'Salvar contexto' }).click()
    await expect(memory.getByRole('alert')).toContainText('Não foi possível salvar o contexto.')
    await expect(memory).toBeVisible()
  })

  test('gerencia o ciclo explícito das memórias do Segundo Cérebro', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 850 })
    await ready(page)
    await page.getByRole('button', { name: 'Memória do workspace' }).click()
    await page.getByRole('button', { name: 'Abrir Segundo Cérebro' }).click()
    const brain = page.getByRole('dialog', { name: 'Segundo Cérebro' })
    await expect(brain).toBeVisible()
    await brain.getByLabel('Tipo').selectOption('decision')
    await brain.getByLabel('Conteúdo').fill('SQLite permanece como fonte de verdade local.')
    await brain.getByRole('button', { name: 'Adicionar para revisão' }).click()
    await expect(brain.getByText('SQLite permanece como fonte de verdade local.')).toBeVisible()
    await brain.getByRole('button', { name: 'Ver histórico' }).click()
    await expect(brain.getByText('Memória criada manualmente.')).toBeVisible()
    await brain.getByRole('button', { name: 'Ocultar histórico' }).click()
    await brain.getByRole('button', { name: 'Aprovar', exact: true }).click()
    await expect(brain.getByRole('button', { name: 'Desatualizar' })).toBeVisible()
    await brain.getByLabel('Buscar memórias').fill('SQLite')
    await brain.getByRole('button', { name: 'Buscar' }).click()
    await expect(brain.locator('.brain-card')).toHaveCount(1)
    await brain.getByRole('button', { name: 'Editar memória' }).click()
    await brain.getByLabel('Editar memória').fill('SQLite continua como fonte de verdade local e recuperável.')
    await brain.getByRole('button', { name: 'Salvar edição' }).click()
    await expect(brain.getByText('SQLite continua como fonte de verdade local e recuperável.')).toBeVisible()
    await brain.getByRole('button', { name: 'Arquivar' }).click()
    await brain.getByRole('button', { name: 'Excluir' }).click()
    await brain.getByRole('button', { name: 'Confirmar exclusão' }).click()
    await expect(brain.getByText('Nenhuma correspondência')).toBeVisible()
  })

  test('transforma propostas do agente somente em candidatas revisáveis', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 850 })
    await ready(page)
    await page.evaluate(() => { window.nocturne.ai.send = async () => {} })
    await page.getByLabel('Mensagem para o agente').fill('Registre um aprendizado durável.')
    await page.getByRole('button', { name: 'Enviar mensagem' }).click()
    await page.evaluate(() => {
      const bridge = (window as unknown as { __nocturneTest: { emitEvent(payload: unknown): void; emitStatus(payload: unknown): void } }).__nocturneTest
      const block = `Resposta sem metadados visíveis.\n\n\`\`\`nocturne-memories\n${JSON.stringify([{ kind: 'learning', scope: 'workspace', content: 'Validar restaurações antes de substituir dados locais.', confidence: 85 }])}\n\`\`\``
      bridge.emitStatus({ status: 'streaming' })
      bridge.emitEvent({ method: 'item/agentMessage/delta', params: { delta: block } })
      bridge.emitEvent({ method: 'turn/completed', params: { turn: { id: 'turn-memory' }, threadId: 'thread-1' } })
    })
    await expect(page.getByText('Resposta sem metadados visíveis.')).toBeVisible()
    await expect(page.getByText('nocturne-memories')).toHaveCount(0)
    await page.getByRole('button', { name: 'Memória do workspace' }).click()
    await page.getByRole('button', { name: 'Abrir Segundo Cérebro' }).click()
    const brain = page.getByRole('dialog', { name: 'Segundo Cérebro' })
    await expect(brain.getByText('Validar restaurações antes de substituir dados locais.')).toBeVisible()
    await expect(brain.locator('.brain-card').getByText('Candidata', { exact: true })).toBeVisible()
    await expect(brain.getByRole('button', { name: 'Aprovar', exact: true })).toBeVisible()
  })

  test('mantém o Segundo Cérebro alinhado em desktop e mobile', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.evaluate(async () => {
      const active = await window.nocturne.brain.create('conversation-1', { kind: 'decision', scope: 'workspace', content: 'SQLite permanece como fonte de verdade local e recuperável.' })
      await window.nocturne.brain.update('conversation-1', active.id, { status: 'active', confidence: 94 })
      const outdated = await window.nocturne.brain.create('conversation-1', { kind: 'preference', scope: 'conversation', content: 'Usar uma preferência temporária de interface nesta conversa.' })
      await window.nocturne.brain.update('conversation-1', outdated.id, { status: 'outdated', confidence: 62 })
      await window.nocturne.brain.extract('conversation-1', `\`\`\`nocturne-memories\n${JSON.stringify([{ kind: 'learning', scope: 'workspace', content: 'Validar restaurações antes de substituir dados locais.', confidence: 86 }])}\n\`\`\``)
    })
    await page.getByRole('button', { name: 'Memória do workspace' }).click()
    await page.getByRole('button', { name: 'Abrir Segundo Cérebro' }).click()
    const brain = page.getByRole('dialog', { name: 'Segundo Cérebro' })
    await expect(brain.locator('.brain-card')).toHaveCount(3)
    const [brainBox, createActionBox] = await Promise.all([
      brain.boundingBox(),
      brain.getByRole('button', { name: 'Adicionar para revisão' }).boundingBox(),
    ])
    expect(brainBox).not.toBeNull()
    expect(createActionBox).not.toBeNull()
    expect((createActionBox?.y ?? 0) + (createActionBox?.height ?? 0)).toBeLessThanOrEqual((brainBox?.y ?? 0) + (brainBox?.height ?? 0))
    const searchField = brain.locator('.brain-search > label')
    const searchAction = brain.getByRole('button', { name: 'Buscar' })
    const statusFilter = brain.getByLabel('Filtrar estado')
    const [searchFieldBox, searchActionBox, statusFilterBox] = await Promise.all([
      searchField.boundingBox(), searchAction.boundingBox(), statusFilter.boundingBox(),
    ])
    expect(searchFieldBox).not.toBeNull()
    expect(searchActionBox).not.toBeNull()
    expect(statusFilterBox).not.toBeNull()
    expect(Math.abs((searchFieldBox?.y ?? 0) - (searchActionBox?.y ?? 0))).toBeLessThan(1)
    expect(Math.abs((searchFieldBox?.y ?? 0) - (statusFilterBox?.y ?? 0))).toBeLessThan(1)
    expect(searchFieldBox?.height).toBe(searchActionBox?.height)
    expect(searchFieldBox?.height).toBe(statusFilterBox?.height)
    await statusFilter.focus()
    await expect(statusFilter).toHaveCSS('outline-style', 'none')
    await expect(statusFilter).toHaveCSS('box-shadow', 'none')
    await expect(brain).toHaveScreenshot('second-brain-dialog.png', { animations: 'disabled', caret: 'hide' })

    await page.setViewportSize({ width: 520, height: 760 })
    await expect(brain.getByRole('tab', { name: 'Biblioteca' })).toHaveAttribute('aria-selected', 'true')
    await expect(brain).toHaveScreenshot('second-brain-dialog-mobile.png', { animations: 'disabled', caret: 'hide' })
    await brain.getByRole('tab', { name: 'Criar memória' }).click()
    const contentField = brain.getByLabel('Conteúdo')
    await contentField.focus()
    await expect(contentField).toHaveCSS('outline-style', 'none')
    await expect(contentField).toHaveCSS('box-shadow', 'none')
    await expect(brain).toHaveScreenshot('second-brain-create-mobile.png', { animations: 'disabled', caret: 'hide' })
  })

  test('confirma a criação de commit no próprio fluxo', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.getByText('Git e commit').click()
    await page.getByRole('textbox', { name: 'Mensagem do commit' }).fill('fix: confirmar operação')
    await page.getByRole('button', { name: 'Criar commit com arquivos selecionados' }).click()
    await expect(page.locator('.product-toast')).toContainText('Commit criado com sucesso.')
  })

  test('oferece rollback somente para um Build reversível', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.evaluate(() => {
      let available = true
      window.nocturne.ai.rollbackStatus = async () => available
        ? { available: true, files: ['src/App.tsx'], createdAt: '2026-07-30T20:00:00.000Z' }
        : { available: false, files: [], reason: 'Rollback concluído.' }
      window.nocturne.ai.rollback = async () => {
        available = false
        return { restored: ['src/App.tsx'] }
      }
      const bridge = (window as unknown as { __nocturneTest: { emitEvent(payload: unknown): void } }).__nocturneTest
      bridge.emitEvent({
        method: 'item/completed',
        params: {
          item: {
            id: 'rollback-file',
            type: 'fileChange',
            status: 'completed',
            changes: [{ path: 'src/App.tsx', kind: 'modified', status: 'completed' }],
          },
        },
      })
    })
    await page.getByRole('tab', { name: 'Atividade' }).click()
    await expect(page.getByText('Rollback do último Build')).toBeVisible()
    await page.getByText('Rollback do último Build').click()
    await page.getByRole('button', { name: 'Reverter alterações' }).click()
    await expect(page.locator('.product-toast')).toContainText('1 arquivo(s) restaurado(s).')
    await expect(page.getByRole('button', { name: 'Reverter alterações' })).toHaveCount(0)
  })

  test('explica o contexto selecionado em cada execução', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.evaluate(() => {
      const now = '2026-07-30T20:00:00.000Z'
      const awareness = {
        mode: 'review',
        createdAt: now,
        selections: [{
          id: 'memory-1', title: 'SQLite como fonte de verdade', source: 'brain-memory', sourceType: 'manual', sourceId: null,
          kind: 'decision', scope: 'workspace', relevance: 87,
          reason: '3 termos relacionados ao pedido; confiança 95%; escopo do workspace; atualização recente.',
          updatedAt: now, contentPreview: 'SQLite permanece como fonte de verdade local.',
        }],
      }
      window.nocturne.conversations.messagePage = async () => ({ items: [
        { id: 'user-awareness', conversationId: 'conversation-1', role: 'user', content: 'Revise a persistência SQLite', metadata: JSON.stringify({ awareness }), createdAt: now },
        { id: 'assistant-awareness', conversationId: 'conversation-1', role: 'assistant', content: 'Revisão concluída.', metadata: null, createdAt: now },
      ], hasMore: false })
    })
    await page.locator('.conversation-open').click()
    const activity = page.locator('#agent-panel-activity')
    await activity.getByText('Contexto usado nesta execução').click()
    await expect(activity.getByText('87% relevante')).toBeVisible()
    await expect(activity.getByText(/confiança 95%/)).toBeVisible()
    await expect(activity.getByText(/memória criada pelo usuário/)).toBeVisible()
    await activity.getByText('Trecho utilizado').click()
    await expect(activity.getByText('SQLite permanece como fonte de verdade local.')).toBeVisible()
    await activity.getByText('Contexto usado nesta execução').click()
    await page.getByText('Contexto usado · 1').click()
    await expect(page.getByText('SQLite como fonte de verdade · 87%')).toBeVisible()
  })

  test('compara e aprova uma atualização incremental no Docs Mode', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.evaluate(() => {
      window.nocturne.documents.prepareMarkdown = async (_conversationId, content) => ({
        target: '/workspace/sample-project/README.md',
        name: 'README.md',
        existing: '# Documento atual\n',
        generated: content,
        expectedHash: 'a'.repeat(64),
      })
      window.nocturne.documents.applyMarkdown = async (_conversationId, preview, strategy) => ({
        target: preview.target,
        strategy,
      })
    })
    await page.locator('.conversation-open').click()
    await page.getByText('Exportar resposta').click()
    await page.getByRole('button', { name: 'Exportar resposta em Markdown' }).click()
    const dialog = page.getByRole('dialog', { name: 'Revisar atualização' })
    await expect(dialog.getByText('# Documento atual')).toBeVisible()
    await expect(dialog.getByText('A interface foi analisada.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Anexar conteúdo' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.product-toast')).toContainText('Conteúdo anexado ao documento.')
  })

  test('mantém falhas de clipboard dentro da solução aberta', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.evaluate(() => {
      window.nocturne.suggestions.page = async () => ({ items: [{
        id: 'suggestion-1', workspaceId: 'workspace-1', conversationId: 'conversation-1', title: 'Melhorar feedback', description: 'Problema', reasoning: 'Evidência', evidence: [{ source: 'interface', detail: 'Feedback ausente.' }], confidence: 80, source: 'Review Mode', responsible: 'Agente de revisão', category: 'accessibility', severity: 'medium', affectedFiles: ['src/App.tsx'], proposedChanges: '+ feedback', expectedBenefits: ['Mais confiança'], complexity: 'low', risk: 'low', status: 'new', history: [], createdAt: '2026-07-13T20:00:00.000Z', updatedAt: '2026-07-13T20:00:00.000Z',
      }], hasMore: false })
      window.nocturne.clipboard.writeText = async () => { throw new Error('Clipboard indisponível.') }
    })
    await page.locator('.conversation-open').click()
    await page.getByRole('tab', { name: /Sugestões/ }).click()
    const documentationMetric = page.locator('.health-grid span').filter({ hasText: 'Documentação' })
    const labelBox = await documentationMetric.getByText('Documentação', { exact: true }).boundingBox()
    const scoreBox = await documentationMetric.getByText('10/10', { exact: true }).boundingBox()
    expect(labelBox).not.toBeNull()
    expect(scoreBox).not.toBeNull()
    expect(scoreBox!.y).toBeGreaterThanOrEqual(labelBox!.y + labelBox!.height)
    await page.getByRole('button', { name: 'Ver solução' }).click()
    const dialog = page.getByRole('dialog', { name: 'Melhorar feedback' })
    await dialog.getByRole('button', { name: 'Copiar diff' }).click()
    await expect(dialog.getByRole('alert')).toContainText('Clipboard indisponível.')
  })

  test('não inicia Build quando a aceitação da sugestão não pode ser persistida', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.evaluate(() => {
      const suggestion: Suggestion = {
        id: 'suggestion-persistence', workspaceId: '/workspace/sample-project', conversationId: 'conversation-1', title: 'Persistir antes de aplicar', description: 'A decisão precisa ser durável.', reasoning: 'O fluxo de aprovação depende do registro local.', evidence: [], confidence: 85, source: 'Review Mode', responsible: 'Agente de revisão', category: 'bug', severity: 'high', affectedFiles: ['src/App.tsx'], proposedChanges: '+ correção', expectedBenefits: ['Auditoria consistente'], complexity: 'low', risk: 'low', status: 'new', history: [], createdAt: '2026-07-13T20:00:00.000Z', updatedAt: '2026-07-13T20:00:00.000Z',
      }
      window.nocturne.suggestions.page = async () => ({ items: [suggestion], hasMore: false })
      window.nocturne.suggestions.status = async () => { throw new Error('Falha ao persistir decisão.') }
      Object.defineProperty(window, '__suggestionSendCount', { configurable: true, writable: true, value: 0 })
      window.nocturne.ai.send = async () => { (window as unknown as { __suggestionSendCount: number }).__suggestionSendCount += 1 }
    })
    await page.locator('.conversation-open').click()
    await page.getByRole('tab', { name: /Sugestões/ }).click()
    await page.getByRole('button', { name: 'Aplicar' }).click()
    await page.getByRole('button', { name: 'Preparar aplicação' }).click()
    await expect(page.getByRole('alert')).toContainText('A sugestão não foi aceita: Falha ao persistir decisão.')
    expect(await page.evaluate(() => (window as unknown as { __suggestionSendCount: number }).__suggestionSendCount)).toBe(0)
  })

  test('recalcula a Saúde do Projeto quando uma sugestão é aplicada', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    await page.evaluate(() => {
      const common = { workspaceId: '/workspace/sample-project', conversationId: 'conversation-1', description: 'A arquitetura precisa de uma fronteira mais clara.', reasoning: 'Responsabilidades observadas no mesmo módulo.', evidence: [], confidence: 75, source: 'Review Mode', responsible: 'Agente de revisão', category: 'architecture' as const, affectedFiles: ['src/App.tsx'], proposedChanges: '+ extrair responsabilidade', expectedBenefits: ['Arquitetura mais clara'], complexity: 'low' as const, risk: 'low' as const, status: 'new' as const, history: [], createdAt: '2026-07-13T20:00:00.000Z', updatedAt: '2026-07-13T20:00:00.000Z' }
      const suggestions: Suggestion[] = [
        { ...common, id: 'suggestion-live-health', title: 'Refinar fronteiras', severity: 'medium' },
        { ...common, id: 'suggestion-remaining', title: 'Separar domínio restante', severity: 'high' },
      ]
      window.nocturne.suggestions.page = async () => ({ items: suggestions.map((suggestion) => ({ ...suggestion })), hasMore: false })
      window.nocturne.suggestions.status = async (_conversationId, suggestionId, status) => {
        const suggestion = suggestions.find((item) => item.id === suggestionId)
        if (!suggestion) throw new Error('Sugestão não encontrada.')
        suggestion.status = status; suggestion.updatedAt = '2026-07-13T20:05:00.000Z'
        return { ...suggestion }
      }
      window.nocturne.ai.send = async () => {}
    })
    await page.locator('.conversation-open').click()
    await page.getByRole('tab', { name: /Sugestões/ }).click()
    const architecture = page.locator('.health-metric').filter({ hasText: 'Arquitetura' })
    await expect(architecture.getByText('7/10', { exact: true })).toBeVisible()
    await page.locator('.suggestion-card').filter({ hasText: 'Refinar fronteiras' }).getByRole('button', { name: 'Aplicar' }).click()
    await page.getByRole('button', { name: 'Preparar aplicação' }).click()
    await expect(architecture.getByText('7/10', { exact: true })).toBeVisible()
    await page.evaluate(() => {
      const bridge = (window as unknown as { __nocturneTest: { emitEvent(payload: unknown): void } }).__nocturneTest
      bridge.emitEvent({ method: 'item/completed', params: { item: { id: 'file-change-health', type: 'fileChange', status: 'completed', changes: [{ path: 'src/App.tsx', kind: 'modified', status: 'completed' }] } } })
      bridge.emitEvent({ method: 'turn/completed', params: { turn: { id: 'turn-live-health' }, threadId: 'thread-1' } })
    })
    const healthCard = page.locator('.health-card')
    await expect(healthCard.locator('.sr-only[role="status"]')).toContainText('Arquitetura passou de 7 para 8')
    await expect(architecture).toHaveClass(/improved/)
    await expect(architecture.locator('.health-score s')).toHaveText('7/10')
    await expect(architecture.locator('.health-score strong')).toHaveText('8/10')
    await expect(page.locator('#agent-inspector')).toHaveScreenshot('project-health-updated.png', { animations: 'disabled', caret: 'hide' })
  })

  for (const viewport of [{ width: 1440, height: 900 }, { width: 980, height: 820 }, { width: 720, height: 800 }, { width: 520, height: 760 }]) {
    test(`mantém a referência visual em ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await ready(page)
      await expect(page).toHaveScreenshot(`renderer-${viewport.width}.png`, { animations: 'disabled', caret: 'hide', fullPage: true })
    })
  }
})

test('diferencia o estado vazio sem dados locais', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-13T20:05:00.000Z'))
  await installNocturneMock(page, { empty: true })
  await page.setViewportSize({ width: 1180, height: 850 })
  await ready(page)
  await expect(page.getByText('Nenhuma conversa ainda')).toBeVisible()
  await expect(page.getByText('O que vamos construir?')).toBeVisible()
})

test('conclui a jornada de primeiro uso e persiste a decisão', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-13T20:05:00.000Z'))
  await installNocturneMock(page, { firstRun: true })
  await page.setViewportSize({ width: 1180, height: 850 })
  await ready(page)
  const onboarding = page.getByRole('dialog', { name: 'Prontidão do Nocturne' })
  await expect(onboarding.getByText('Ambiente pronto para trabalhar')).toBeVisible()
  await onboarding.getByRole('button', { name: 'Continuar' }).click()
  await onboarding.getByRole('button', { name: 'Continuar' }).click()
  await onboarding.getByRole('button', { name: 'Continuar' }).click()
  await onboarding.getByRole('button', { name: 'Concluir configuração' }).click()
  await expect(onboarding).toBeHidden()
  await expect(page.locator('.product-toast')).toContainText('Nocturne pronto para trabalhar.')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('nocturne.onboarding.completed'))).toBe('true')
})

test('oferece login por conta e chave de API como caminhos separados', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-13T20:05:00.000Z'))
  await installNocturneMock(page, { signedOut: true })
  await page.setViewportSize({ width: 1180, height: 850 })
  await ready(page)
  await page.getByRole('button', { name: 'Abrir configurações' }).last().click()
  const dialog = page.getByRole('dialog', { name: 'Configurações' })
  await expect(dialog.getByRole('heading', { name: 'IA', exact: true })).toBeVisible()
  await expect(dialog.getByText('Conectar IA')).toBeVisible()
  await expect(dialog.getByText('Use sua conta ChatGPT pelo Codex CLI, uma chave de API ou um modelo local.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Adicionar conta, API ou modelo local' }).click()
  await expect(dialog.getByRole('button', { name: 'Conta ChatGPT' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'OpenAI API' })).toBeVisible()
})

test('mantém o histórico isolado até reautorizar um workspace restaurado', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-13T20:05:00.000Z'))
  await installNocturneMock(page, { unauthorized: true })
  await page.setViewportSize({ width: 1180, height: 850 })
  await ready(page)
  await expect(page.getByText('Reautorizar workspace?')).toBeVisible()
  const before = await page.evaluate(() => (window as unknown as { __nocturneTest: { calls(): { memoryReads: number } } }).__nocturneTest.calls())
  expect(before).toMatchObject({ memoryReads: 0 })
  await page.getByRole('button', { name: 'Selecionar pasta' }).click()
  await expect(page.getByText('Reautorizar workspace?')).toBeHidden()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nocturneTest: { calls(): { selectedExpected?: string; memoryReads: number } } }).__nocturneTest.calls())).toEqual({ selectedExpected: '/workspace/sample-project', memoryReads: 1 })
})

test('orienta a relocalização de um projeto movido sem perder a conversa', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-13T20:05:00.000Z'))
  await installNocturneMock(page, { moved: true })
  await page.setViewportSize({ width: 1180, height: 850 })
  await ready(page)
  await expect(page.getByText('Localizar projeto movido?')).toBeVisible()
  await expect(page.getByText('Pasta do projeto não encontrada.')).toBeVisible()
  await page.getByRole('button', { name: 'Localizar pasta' }).click()
  await expect(page.getByText('Localizar projeto movido?')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Workspace renamed-project' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nocturneTest: { calls(): { selectedExpected?: string; memoryReads: number } } }).__nocturneTest.calls())).toEqual({ selectedExpected: '/workspace/sample-project', memoryReads: 1 })
})

test('recarrega o contexto quando arquivos da .nocturne mudam externamente', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-13T20:05:00.000Z'))
  await installNocturneMock(page)
  await page.setViewportSize({ width: 1180, height: 850 })
  await ready(page)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nocturneTest: { calls(): { memoryReads: number } } }).__nocturneTest.calls().memoryReads)).toBe(1)
  await page.evaluate(() => {
    const bridge = (window as unknown as { __nocturneTest: { emitWorkspaceChange(payload: unknown): void } }).__nocturneTest
    bridge.emitWorkspaceChange({
      workspace: '/workspace/sample-project',
      paths: ['.nocturne/memory.md', 'src/App.tsx'],
      overflow: false,
      detectedAt: new Date().toISOString(),
    })
  })
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nocturneTest: { calls(): { memoryReads: number } } }).__nocturneTest.calls().memoryReads)).toBe(2)
})
