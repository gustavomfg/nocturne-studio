export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export const JSON_VALUE_LIMITS = Object.freeze({
  maxDepth: 32,
})

/**
 * Checks the value that will cross a persistence boundary without allowing
 * JSON.stringify to silently drop or coerce unsupported JavaScript values.
 * The character count mirrors JSON.stringify's output, but does not allocate
 * the serialized payload while checking a potentially oversized value.
 */
export function isJsonValueWithinLimit(
  value: unknown,
  maxCharacters: number,
  maxDepth = JSON_VALUE_LIMITS.maxDepth,
): value is JsonValue {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 0) return false
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) return false
  try {
    return serializedCharacterCount(value, 0, maxCharacters, maxDepth, new Set()) !== null
  } catch {
    return false
  }
}

export function serializeJsonValue(
  value: unknown,
  maxCharacters: number,
  maxDepth = JSON_VALUE_LIMITS.maxDepth,
): string {
  if (!isJsonValueWithinLimit(value, maxCharacters, maxDepth)) {
    throw new Error('O metadata precisa conter apenas valores JSON válidos dentro do limite permitido.')
  }
  const serialized = JSON.stringify(value)
  if (typeof serialized !== 'string' || serialized.length > maxCharacters) {
    throw new Error('O metadata excede o limite permitido para persistência.')
  }
  return serialized
}

function serializedCharacterCount(
  value: unknown,
  depth: number,
  maxCharacters: number,
  maxDepth: number,
  ancestors: Set<object>,
): number | null {
  if (depth > maxDepth) return null
  if (value === null) return maxCharacters >= 4 ? 4 : null
  switch (typeof value) {
    case 'string': return stringCharacterCount(value, maxCharacters)
    case 'boolean': return value ? (maxCharacters >= 4 ? 4 : null) : (maxCharacters >= 5 ? 5 : null)
    case 'number': {
      if (!Number.isFinite(value)) return null
      const serialized = JSON.stringify(value)
      return typeof serialized === 'string' && serialized.length <= maxCharacters ? serialized.length : null
    }
    case 'object': break
    default: return null
  }

  const objectValue = value as object
  if (ancestors.has(objectValue)) return null
  try {
    const prototype = Object.getPrototypeOf(objectValue)
    if (Array.isArray(objectValue)) {
      if (prototype !== Array.prototype) return null
    } else if (prototype !== Object.prototype && prototype !== null) return null
    if (typeof (objectValue as { toJSON?: unknown }).toJSON === 'function') return null
    if (Object.getOwnPropertySymbols(objectValue).length > 0) return null
    ancestors.add(objectValue)
    if (Array.isArray(objectValue)) {
      let length = 2
      if (length > maxCharacters) return null
      for (let index = 0; index < objectValue.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(objectValue, index)) return null
        const childLength = serializedCharacterCount(objectValue[index], depth + 1, maxCharacters, maxDepth, ancestors)
        if (childLength === null) return null
        length += childLength + (index ? 1 : 0)
        if (length > maxCharacters) return null
      }
      return length
    }

    let length = 2
    if (length > maxCharacters) return null
    for (const [index, key] of Object.keys(objectValue).entries()) {
      const keyLength = stringCharacterCount(key, maxCharacters)
      if (keyLength === null) return null
      const childLength = serializedCharacterCount((objectValue as Record<string, unknown>)[key], depth + 1, maxCharacters, maxDepth, ancestors)
      if (childLength === null) return null
      length += keyLength + 1 + childLength + (index ? 1 : 0)
      if (length > maxCharacters) return null
    }
    return length
  } finally {
    ancestors.delete(objectValue)
  }
}

function stringCharacterCount(value: string, maxCharacters: number): number | null {
  let length = 2
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 0x22 || code === 0x5c) length += 2
    else if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) length += 2
    else if (code <= 0x1f || code >= 0xd800 && code <= 0xdfff) {
      const next = value.charCodeAt(index + 1)
      if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        length += 2
        index += 1
      } else length += 6
    } else length += 1
    if (length > maxCharacters) return null
  }
  return length
}
