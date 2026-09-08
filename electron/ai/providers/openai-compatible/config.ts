import { BlockList, isIP } from 'node:net'
import { z } from 'zod'
import type { ProviderSource } from '../../../../shared/ai/provider'
import { PROVIDER_CONFIGURATION_LIMITS } from '../../../../shared/ai/providerConfiguration'

export const OPENAI_COMPATIBLE_LIMITS = {
  models: 25_000,
  modelsResponseBytes: 2 * 1024 * 1024,
  streamResponseBytes: 10 * 1024 * 1024,
  streamEventBytes: 1024 * 1024,
  embeddingsResponseBytes: 16 * 1024 * 1024,
} as const

const configSchema = z.object({
  id: z.string().trim().min(1).max(512),
  displayName: z.string().trim().min(1).max(500),
  source: z.enum(['local', 'remote']),
  baseUrl: z.string().trim().min(1).max(2_048),
  timeoutMs: z.number().int()
    .min(PROVIDER_CONFIGURATION_LIMITS.minimumTimeoutMs)
    .max(PROVIDER_CONFIGURATION_LIMITS.maximumTimeoutMs),
  enabled: z.boolean(),
  requiresAuthentication: z.boolean(),
}).strict()

export interface OpenAICompatibleConfig {
  id: string
  displayName: string
  source: ProviderSource
  baseUrl: string
  timeoutMs: number
  enabled: boolean
  requiresAuthentication: boolean
}

export function parseOpenAICompatibleConfig(input: unknown): OpenAICompatibleConfig {
  const config = configSchema.parse(input)
  const baseUrl = validateBaseUrl(config.baseUrl, config.source)
  return { ...config, baseUrl: baseUrl.href.replace(/\/$/, '') }
}

export function providerEndpoint(config: OpenAICompatibleConfig, resource: 'models' | 'chat/completions' | 'embeddings') {
  const base = new URL(`${config.baseUrl}/`)
  const path = `${base.pathname.replace(/\/$/, '')}/${resource}`.replace(/\/{2,}/g, '/')
  base.pathname = path
  return base
}

function validateBaseUrl(value: string, source: ProviderSource) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('O endpoint OpenAI-compatible é inválido.')
  }
  if (url.username || url.password) {
    throw new Error('O endpoint não pode conter credenciais.')
  }
  if (url.search || url.hash) {
    throw new Error('O endpoint não pode conter query ou fragmento.')
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('O endpoint deve usar HTTP ou HTTPS.')
  }

  const loopback = isLoopbackHost(url.hostname)
  if (url.protocol === 'http:' && (!loopback || source !== 'local')) {
    throw new Error('HTTP sem TLS é permitido somente para Providers locais em loopback.')
  }
  if (source === 'remote' && isUnsafeRemoteHost(url.hostname)) {
    throw new Error('Providers remotos não podem usar endereços locais ou reservados.')
  }
  return url
}

function isLoopbackHost(hostname: string) {
  const normalized = hostname.replace(/^\[(.*)]$/, '$1').toLowerCase()
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
}

const unsafeRemoteIpv4Addresses = new BlockList()
const unsafeRemoteIpv6Addresses = new BlockList()

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  unsafeRemoteIpv4Addresses.addSubnet(network, prefix, 'ipv4')
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:2::', 48],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  unsafeRemoteIpv6Addresses.addSubnet(network, prefix, 'ipv6')
}

export function isPublicRemoteAddress(address: string) {
  const normalized = address.replace(/^\[(.*)]$/, '$1').toLowerCase()
  const family = isIP(normalized)
  if (family === 0) return false
  return family === 4
    ? !unsafeRemoteIpv4Addresses.check(normalized, 'ipv4')
    : !unsafeRemoteIpv6Addresses.check(normalized, 'ipv6')
}

function isUnsafeRemoteHost(hostname: string) {
  const normalized = hostname.replace(/^\[(.*)]$/, '$1').toLowerCase()
  if (normalized === 'localhost' || normalized === 'metadata.google.internal') return true
  const family = isIP(normalized)
  return family !== 0 && !isPublicRemoteAddress(normalized)
}
