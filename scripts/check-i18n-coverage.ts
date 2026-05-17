#!/usr/bin/env bun

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve, relative } from 'node:path'

const ROOT_DIR = resolve(import.meta.dir, '..')
const LOCALE_PATH = resolve(ROOT_DIR, 'packages', 'shared', 'src', 'i18n', 'locales', 'en.json')
const SOURCE_ROOTS = [
  resolve(ROOT_DIR, 'apps'),
  resolve(ROOT_DIR, 'packages'),
]
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const SKIPPED_DIRS = new Set([
  '.git',
  'dist',
  'node_modules',
  'release',
])
const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/
const TRANSLATION_CALL_PATTERN =
  /\b(?:i18n\.)?t\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g

type FlatTranslations = Set<string>

function flattenTranslationKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : []
  }

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) {
    return prefix ? [prefix] : []
  }

  return entries.flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      return flattenTranslationKeys(child, nextPrefix)
    }
    return [nextPrefix]
  })
}

function loadTranslationKeys(): FlatTranslations {
  const contents = JSON.parse(readFileSync(LOCALE_PATH, 'utf8')) as Record<string, unknown>
  return new Set(flattenTranslationKeys(contents))
}

function hasTranslationKey(translationKeys: FlatTranslations, key: string): boolean {
  if (translationKeys.has(key)) return true

  for (const translationKey of translationKeys) {
    if (!PLURAL_SUFFIX.test(translationKey)) continue
    if (translationKey.startsWith(`${key}_`)) return true
  }

  return false
}

function walkFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (SKIPPED_DIRS.has(entry.name)) continue
    const fullPath = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath))
      continue
    }
    if (!entry.isFile()) continue
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue
    files.push(fullPath)
  }

  return files
}

function collectMissingKeys(filePath: string, translationKeys: FlatTranslations): string[] {
  const contents = readFileSync(filePath, 'utf8')
  const missing = new Set<string>()

  for (const match of contents.matchAll(TRANSLATION_CALL_PATTERN)) {
    const rawKey = match[2]
    if (!rawKey || rawKey.includes('${')) continue
    if (hasTranslationKey(translationKeys, rawKey)) continue
    missing.add(rawKey)
  }

  return [...missing]
}

function main(): void {
  if (!statSync(LOCALE_PATH).isFile()) {
    throw new Error(`Missing locale source: ${LOCALE_PATH}`)
  }

  const translationKeys = loadTranslationKeys()
  const errors: string[] = []

  for (const root of SOURCE_ROOTS) {
    for (const filePath of walkFiles(root)) {
      const missingKeys = collectMissingKeys(filePath, translationKeys)
      if (missingKeys.length === 0) continue
      errors.push(
        `${relative(ROOT_DIR, filePath)}: missing ${missingKeys.length} key(s): ${missingKeys.join(', ')}`,
      )
    }
  }

  if (errors.length > 0) {
    console.error('i18n coverage check failed:')
    for (const error of errors) {
      console.error(`  ${error}`)
    }
    process.exit(1)
  }

  console.log(`i18n coverage OK (${translationKeys.size} keys checked)`)
}

main()
