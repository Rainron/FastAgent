import Database from 'better-sqlite3'
import { cpSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'

export interface MoveManagedDataResult {
  sourceRoot: string
  targetRoot: string
}

function contains(parent: string, child: string) {
  const value = relative(parent, child)
  return value === '' || (!value.startsWith('..') && !isAbsolute(value))
}

function verifyDatabase(root: string) {
  const databasePath = join(root, 'data', 'fastagent.db')
  if (!existsSync(databasePath)) throw new Error('数据目录缺少 fastagent.db')
  const db = new Database(databasePath, { readonly: true })
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('目标数据库完整性检查失败')
  } finally {
    db.close()
  }
}

export function moveManagedData(sourceRoot: string, targetRoot: string): MoveManagedDataResult {
  if (!isAbsolute(sourceRoot) || !isAbsolute(targetRoot)) throw new Error('数据目录必须是绝对路径')
  const source = resolve(sourceRoot)
  const target = resolve(targetRoot)
  if (source === target) return { sourceRoot: source, targetRoot: target }
  if (contains(source, target) || contains(target, source)) throw new Error('源目录和目标目录不能互相包含')
  if (existsSync(target) && readdirSync(target).length > 0) throw new Error('目标目录必须为空')

  const staging = `${target}.migrating-${randomUUID()}`
  try {
    cpSync(source, staging, { recursive: true, errorOnExist: true })
    verifyDatabase(staging)
    if (existsSync(target)) rmSync(target, { recursive: true })
    renameSync(staging, target)
    return { sourceRoot: source, targetRoot: target }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
