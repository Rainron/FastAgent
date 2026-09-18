import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrateLegacyLocalModels, ModelConnectionStore, MODEL_CONNECTIONS_SQL } from './model-connections'

vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
  decryptString: (value: Buffer) => value.toString().slice(10)
} }))
const databases: Database.Database[] = []
afterEach(() => { databases.splice(0).forEach((db) => db.close()) })
function createStore() {
  const db = new Database(':memory:')
  databases.push(db)
  db.exec('CREATE TABLE local_models(id INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL,secrets BLOB,updated_at TEXT NOT NULL)')
  db.exec(MODEL_CONNECTIONS_SQL)
  return { db, store: new ModelConnectionStore(db) }
}
describe('模型连接存储', () => {
  it('模型思考映射贯穿保存、摘要与运行时，编辑名称不会丢失能力', () => {
    const { store } = createStore()
    const thinkingLevelMap = { minimal: null, xhigh: 'xhigh', max: 'max' }
    const connection = store.save({ providerId: 'openai', authMode: 'api-key', models: [{ modelId: 'advanced', reasoning: true, thinkingLevelMap }] })
    expect(connection.models[0].thinking_level_map).toEqual(thinkingLevelMap)
    expect(store.runtimeConfig(-connection.models[0].id)?.thinking_level_map).toEqual(thinkingLevelMap)
    const edited = store.save({ id: connection.id, providerId: 'openai', authMode: 'api-key', models: [{ id: connection.models[0].id, modelId: 'advanced', name: '新名称' }] })
    expect(edited.models[0].thinking_level_map).toEqual(thinkingLevelMap)
  })
  it('同厂商多连接隔离密钥，一连接多模型且保留负数ID', () => {
    const { store } = createStore()
    const a = store.save({ providerId: 'openai', authMode: 'api-key', apiKey: 'secret-a', models: [{ modelId: 'gpt-a' }, { modelId: 'gpt-b' }] })
    const b = store.save({ providerId: 'openai', authMode: 'api-key', apiKey: 'secret-b', models: [{ modelId: 'gpt-a' }] })
    expect(a.id).not.toBe(b.id)
    expect(a.models).toHaveLength(2)
    expect(a.models.every((m) => m.id < 0)).toBe(true)
    expect(JSON.stringify(store.list())).not.toContain('secret-')
    const edited = store.save({ id: a.id, providerId: 'openai', authMode: 'api-key', apiKey: '', models: a.models.map((m) => ({ id: m.id, modelId: m.model_name })) })
    expect(edited.models.map((m) => m.id)).toEqual(a.models.map((m) => m.id))
    expect(store.runtimeConfig(-a.models[0].id)?.api_key).toBe('secret-a')
    expect(store.runtimeConfig(-b.models[0].id)?.api_key).toBe('secret-b')
  })
  it('新连接未提供能力元数据时默认保留思考等级', () => {
    const { store } = createStore()
    const connection = store.save({ providerId: 'openai', authMode: 'api-key', apiKey: 'secret', models: [{ modelId: 'reasoning-model' }] })
    expect(connection.models[0].supports_thinking).toBe(true)
    expect(store.runtimeConfig(-connection.models[0].id)?.supports_thinking).toBe(true)
  })
  it('目的地址改变不能携带保存的密钥', () => {
    const { store } = createStore()
    const a = store.save({ providerId: 'openai', authMode: 'api-key', apiKey: 'secret-a', models: [{ modelId: 'gpt-a' }] })
    expect(() => store.save({ id: a.id, providerId: 'openai', authMode: 'api-key', baseUrl: 'https://other.example/v1', models: [] })).toThrow(/密钥/)
    expect(store.list()[0].models).toHaveLength(1)
  })
  it('序列化同一连接的OAuth刷新并在退出后删除凭据', async () => {
    const { store } = createStore()
    const a = store.save({ providerId: 'openai', authMode: 'oauth', models: [] })
    const credentials = store.credentials(a.id)
    await credentials.modify('openai-codex', async () => ({ type: 'oauth', refresh: 'r', access: 'a', expires: 0, count: 0 }))
    await Promise.all(Array.from({ length: 5 }, () => credentials.modify('openai-codex', async (old) => ({ ...old!, count: Number((old as any).count) + 1 }))))
    expect(await credentials.read('openai-codex')).toMatchObject({ count: 5 })
    await credentials.delete('openai-codex')
    expect(store.list()[0].hasCredentials).toBe(false)
  })

  it('迁移旧本地模型时保留模型行 ID 并把密文移到独立连接', () => {
    const { db, store } = createStore()
    const payload = { name: '旧网关', provider: '旧网关', protocol: 'openai', base_url: 'https://legacy.example/v1', model_name: 'legacy-model', model_kind: 'chat' }
    db.prepare('INSERT INTO local_models(payload,secrets,updated_at) VALUES(?,?,?)').run(JSON.stringify(payload), Buffer.from('encrypted:legacy'), '2024-01-02T03:04:05.000Z')
    const row = db.prepare('SELECT id FROM local_models').get() as { id: number }

    migrateLegacyLocalModels(db)

    const migrated = store.list()[0]
    expect(migrated.providerId).toBe('custom')
    expect(migrated.models[0].id).toBe(-row.id)
    expect(migrated.models[0].model_name).toBe('legacy-model')
    expect(migrated.models[0].base_url).toBe('https://legacy.example/v1')
    expect(migrated.models[0].supports_thinking).toBe(true)
    expect(db.prepare('SELECT secrets FROM local_models WHERE id=?').get(row.id)).toEqual({ secrets: null })
    expect(db.prepare('SELECT secrets,updated_at FROM model_connections').get()).toEqual({ secrets: Buffer.from('encrypted:legacy'), updated_at: '2024-01-02T03:04:05.000Z' })
  })

  it('损坏的旧模型 JSON 不阻塞迁移和连接列表读取', () => {
    const { db, store } = createStore()
    db.prepare('INSERT INTO local_models(payload,secrets,updated_at) VALUES(?,?,?)').run('{broken', null, new Date().toISOString())
    expect(() => migrateLegacyLocalModels(db)).not.toThrow()
    expect(store.list()).toEqual([])
  })
})
