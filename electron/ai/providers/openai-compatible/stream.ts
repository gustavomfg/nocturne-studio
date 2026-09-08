import type {
  ProviderExecutionControl,
  ProviderExecutionResult,
} from '../../../../shared/ai/providerExecution'
import { OPENAI_COMPATIBLE_LIMITS } from './config'

export class OpenAICompatibleProtocolError extends Error {
  constructor(message = 'Resposta OpenAI-compatible inválida.') {
    super(message)
    this.name = 'OpenAICompatibleProtocolError'
  }
}

export async function consumeOpenAICompatibleStream(
  response: Response,
  executionId: string,
  control: ProviderExecutionControl,
): Promise<ProviderExecutionResult> {
  if (!response.body) throw new OpenAICompatibleProtocolError()
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('text/event-stream')) {
    throw new OpenAICompatibleProtocolError()
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let responseBytes = 0
  let finishReason: ProviderExecutionResult['finishReason'] | undefined
  let receivedTerminal = false
  let receivedDone = false

  const consumeEvent = (event: string) => {
    if (receivedDone) return
    if (Buffer.byteLength(event, 'utf8') > OPENAI_COMPATIBLE_LIMITS.streamEventBytes) {
      throw new OpenAICompatibleProtocolError()
    }
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) return
    if (data.trim() === '[DONE]') {
      receivedTerminal = true
      receivedDone = true
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      throw new OpenAICompatibleProtocolError()
    }
    const payload = asRecord(parsed)
    if (!payload) throw new OpenAICompatibleProtocolError()

    const choices = Array.isArray(payload.choices) ? payload.choices : []
    for (const choiceValue of choices) {
      const choice = asRecord(choiceValue)
      if (!choice) throw new OpenAICompatibleProtocolError()
      const delta = asRecord(choice.delta)
      if (typeof delta?.content === 'string' && delta.content.length > 0) {
        control.emit({
          type: 'message.delta',
          messageId: `${executionId}:assistant`,
          delta: delta.content,
        })
      }
      const nativeFinish = choice.finish_reason
      if (nativeFinish === null || nativeFinish === undefined) continue
      if (nativeFinish === 'tool_calls' || nativeFinish === 'function_call') {
        throw new OpenAICompatibleProtocolError()
      }
      finishReason = nativeFinish === 'stop'
        ? 'stop'
        : nativeFinish === 'length'
          ? 'length'
          : 'unknown'
      receivedTerminal = true
    }
    const usage = normalizeUsage(payload.usage)
    if (usage) control.emit({ type: 'usage.updated', usage })
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      responseBytes += value.byteLength
      if (responseBytes > OPENAI_COMPATIBLE_LIMITS.streamResponseBytes) {
        throw new OpenAICompatibleProtocolError()
      }
      buffer += decoder.decode(value, { stream: true })
      let boundary = eventBoundary(buffer)
      while (boundary) {
        const event = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary.length)
        consumeEvent(event)
        boundary = eventBoundary(buffer)
      }
      if (Buffer.byteLength(buffer, 'utf8') > OPENAI_COMPATIBLE_LIMITS.streamEventBytes) {
        throw new OpenAICompatibleProtocolError()
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) consumeEvent(buffer)
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }

  if (!receivedTerminal) throw new OpenAICompatibleProtocolError()
  return { finishReason: finishReason ?? 'unknown' }
}

export async function readBoundedJson(response: Response, maxBytes = OPENAI_COMPATIBLE_LIMITS.modelsResponseBytes): Promise<unknown> {
  if (!response.body) throw new OpenAICompatibleProtocolError()
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('json') && !contentType.includes('text/plain')) {
    throw new OpenAICompatibleProtocolError('Tipo de conteúdo inesperado.')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let content = ''
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        throw new OpenAICompatibleProtocolError()
      }
      content += decoder.decode(value, { stream: true })
    }
    content += decoder.decode()
    return JSON.parse(content)
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    if (error instanceof OpenAICompatibleProtocolError) throw error
    throw new OpenAICompatibleProtocolError()
  } finally {
    reader.releaseLock()
  }
}

function eventBoundary(value: string) {
  const unix = value.indexOf('\n\n')
  const windows = value.indexOf('\r\n\r\n')
  if (unix < 0 && windows < 0) return undefined
  if (windows >= 0 && (unix < 0 || windows < unix)) {
    return { index: windows, length: 4 }
  }
  return { index: unix, length: 2 }
}

function normalizeUsage(value: unknown) {
  const usage = asRecord(value)
  if (!usage) return undefined
  const normalized = {
    inputTokens: nonnegativeInteger(usage.prompt_tokens),
    cachedInputTokens: nonnegativeInteger(
      asRecord(usage.prompt_tokens_details)?.cached_tokens,
    ),
    outputTokens: nonnegativeInteger(usage.completion_tokens),
  }
  return Object.values(normalized).some((entry) => entry !== undefined)
    ? normalized
    : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function nonnegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}
