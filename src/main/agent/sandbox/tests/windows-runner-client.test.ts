import { describe, expect, it, vi } from 'vitest'
import { encodeRequest, RunnerClient, RunnerFrameParser, type RunnerHandle } from '../providers/windows-native/windows-runner-client'
import { isSandboxError } from '../sandbox-errors'

describe('RunnerFrameParser', () => {
  it('按行解析 JSONL 帧', () => {
    const parser = new RunnerFrameParser()
    const frames = parser.push('{"type":"started","id":"p1","pid":9}\n{"type":"exited","id":"p1","exitCode":0}\n')
    expect(frames.map((frame) => frame.type)).toEqual(['started', 'exited'])
  })

  it('未闭合的行留到下一块再解析', () => {
    const parser = new RunnerFrameParser()
    expect(parser.push('{"type":"stdout","id":"p1","da')).toEqual([])
    const frames = parser.push('ta":"aGk="}\n')
    expect(frames).toEqual([{ type: 'stdout', id: 'p1', data: 'aGk=' }])
  })

  it('非法帧被记录但不中断解析', () => {
    const parser = new RunnerFrameParser()
    const frames = parser.push('not json\n{"type":"weird","id":"p1"}\n{"type":"exited","id":"p1","exitCode":1}\n')
    expect(frames.map((frame) => frame.type)).toEqual(['exited'])
    expect(parser.invalidFrames).toHaveLength(2)
  })

  it('ready 帧按 session 校验，缺字段时判为非法', () => {
    const parser = new RunnerFrameParser()
    const frames = parser.push('{"type":"ready","session":"s1","account":"FastAgentSandboxOn"}\n{"type":"ready"}\n')
    expect(frames).toEqual([{ type: 'ready', session: 's1', account: 'FastAgentSandboxOn' }])
    expect(parser.invalidFrames).toHaveLength(1)
  })
})

function fakeHandle() {
  const written: string[] = []
  let dataListener: ((chunk: Buffer) => void) | null = null
  let closeListener: ((code: number | null) => void) | null = null
  const handle: RunnerHandle = {
    write: (payload) => { written.push(payload) },
    onData: (listener) => { dataListener = listener },
    onClose: (listener) => { closeListener = listener },
    kill: vi.fn()
  }
  return {
    handle,
    written,
    emit: (line: string) => dataListener?.(Buffer.from(line, 'utf8')),
    close: () => closeListener?.(1)
  }
}

describe('RunnerClient 握手', () => {
  it('收到 ready 帧后会话才算建立', async () => {
    const fake = fakeHandle()
    const client = new RunnerClient(fake.handle)
    fake.emit('{"type":"ready","session":"s1","account":"FastAgentSandboxOn"}\n')
    await expect(client.ready).resolves.toBeUndefined()
  })

  it('runner 未握手就退出时握手以 runner_failed 失败', async () => {
    const fake = fakeHandle()
    const client = new RunnerClient(fake.handle)
    fake.close()
    await expect(client.ready).rejects.toSatisfy((error: unknown) => isSandboxError(error) && error.code === 'runner_failed')
  })
})

describe('RunnerClient', () => {
  it('exec 发出 exec 帧并在 exited 时结算', async () => {
    const fake = fakeHandle()
    const client = new RunnerClient(fake.handle)
    const chunks: string[] = []
    const process = await client.exec({ command: 'echo hi', cwd: 'D:\\work', env: { PATH: 'C:\\bin' }, onData: (chunk) => chunks.push(chunk.toString('utf8')) })
    const request = JSON.parse(fake.written[0]) as { type: string; command: string; env: Record<string, string> }
    expect(request.type).toBe('exec')
    expect(request.command).toBe('echo hi')
    expect(request.env).toEqual({ PATH: 'C:\\bin' })

    fake.emit(`{"type":"stdout","id":"${process.id}","data":"${Buffer.from('hi').toString('base64')}"}\n`)
    fake.emit(`{"type":"exited","id":"${process.id}","exitCode":0}\n`)
    await expect(process.exit).resolves.toEqual({ exitCode: 0 })
    expect(chunks).toEqual(['hi'])
  })

  it('error 帧转成带目标的沙箱错误', async () => {
    const fake = fakeHandle()
    const client = new RunnerClient(fake.handle)
    const process = await client.exec({ command: 'type id_rsa', cwd: '.', env: {}, onData: () => undefined })
    fake.emit(`{"type":"error","id":"${process.id}","code":"filesystem_denied","target":"C:\\\\Users\\\\lake\\\\.ssh"}\n`)
    await expect(process.exit).rejects.toSatisfy(
      (error: unknown) => isSandboxError(error) && error.code === 'filesystem_denied' && error.target === 'C:\\Users\\lake\\.ssh'
    )
  })

  it('runner 退出时挂起的命令全部以失败结算', async () => {
    const fake = fakeHandle()
    const client = new RunnerClient(fake.handle)
    const process = await client.exec({ command: 'npm test', cwd: '.', env: {}, onData: () => undefined })
    fake.close()
    await expect(process.exit).rejects.toSatisfy((error: unknown) => isSandboxError(error) && error.code === 'runner_failed')
  })

  it('取消时发送 cancel 帧', async () => {
    const fake = fakeHandle()
    const controller = new AbortController()
    const client = new RunnerClient(fake.handle)
    const process = await client.exec({ command: 'sleep 100', cwd: '.', env: {}, signal: controller.signal, onData: () => undefined })
    controller.abort()
    expect(fake.written.at(-1)).toBe(encodeRequest({ type: 'cancel', id: process.id }))
    fake.emit(`{"type":"exited","id":"${process.id}","exitCode":null}\n`)
    await expect(process.exit).resolves.toEqual({ exitCode: null })
  })
})
