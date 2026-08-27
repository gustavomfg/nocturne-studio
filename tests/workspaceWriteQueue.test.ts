import { describe, expect, it } from 'vitest'
import { enqueueSerializedWrite } from '../electron/persistence/SerializedWriteQueue'

describe('fila de escritas relacionadas do workspace', () => {
  it('serializa operações da mesma chave e libera a fila após falha', async () => {
    const order: string[] = []
    let release!: () => void
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => { started = resolve })
    const first = enqueueSerializedWrite('workspace-a', async () => {
      order.push('first-start')
      started()
      await new Promise<void>((resolve) => { release = resolve })
      order.push('first-end')
      return 'first'
    })
    const second = enqueueSerializedWrite('workspace-a', async () => {
      order.push('second')
      return 'second'
    })

    await startedPromise
    expect(order).toEqual(['first-start'])
    release()
    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
    expect(order).toEqual(['first-start', 'first-end', 'second'])

    await expect(enqueueSerializedWrite('workspace-a', async () => { throw new Error('falha') })).rejects.toThrow('falha')
    await expect(enqueueSerializedWrite('workspace-a', () => 'after-failure')).resolves.toBe('after-failure')
  })

  it('mantém filas independentes para workspaces diferentes', async () => {
    const values = await Promise.all([
      enqueueSerializedWrite('workspace-b', () => 'b'),
      enqueueSerializedWrite('workspace-c', () => 'c'),
    ])
    expect(values).toEqual(['b', 'c'])
  })
})
