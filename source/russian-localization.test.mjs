import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const root = new URL('./overlay/', import.meta.url)
const catalog = (language) =>
  JSON.parse(
    readFileSync(
      new URL(`config/scripts/orchestra-plugin/orchestra-${language}.json`, root),
      'utf8'
    )
  )
const ru = catalog('ru')
const zh = catalog('zh')
const source = readFileSync(
  new URL(
    'src/renderer/src/components/orchestra/plugin-frame/orchestra-plugin-frame-presentation.ts',
    root
  ),
  'utf8'
)

function flatten(value, prefix = '') {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const path = prefix ? `${prefix}.${key}` : key
      return typeof entry === 'string' ? [[path, entry]] : Object.entries(flatten(entry, path))
    })
  )
}

const selectorBody = source.match(
  /export function orchestraPluginLanguage\([^\n]+\{\n([\s\S]*?)\n\}/
)?.[1]
assert.ok(selectorBody, 'the locale selector must be present')
const selectLanguage = new Function('locale', selectorBody)

test('Russian catalog covers the same UI keys and preserves every interpolation', () => {
  const russian = flatten(ru)
  const chinese = flatten(zh)
  assert.deepEqual(Object.keys(russian).sort(), Object.keys(chinese).sort())
  for (const [key, value] of Object.entries(chinese)) {
    assert.ok(russian[key].trim(), `${key} must not be empty`)
    const variables = (text) => (text.match(/\{\{[^}]+\}\}/g) ?? []).sort()
    assert.deepEqual(variables(russian[key]), variables(value), key)
  }
})

test('host Russian locales select Russian and other locale behavior is preserved', () => {
  for (const locale of ['ru', 'ru-RU', 'ru-BY', 'ru-Cyrl-RU', 'RU-ru']) {
    assert.equal(selectLanguage(locale), 'ru', locale)
  }
  for (const locale of ['zh', 'zh-CN', 'zh-Hans', 'zh-SG']) {
    assert.equal(selectLanguage(locale), 'zh', locale)
  }
  for (const locale of ['en', 'en-US', 'zh-Hant', 'zh-TW', 'zh-HK', 'zh-MO', 'de', 'rue']) {
    assert.equal(selectLanguage(locale), 'en', locale)
  }
})

test('Russian resources are registered before changing language and are reused', async () => {
  const body = source.match(
    /export async function followOrcaLocale\([^\n]+\{\n([\s\S]*)\}\s*$/
  )?.[1]
  assert.ok(body, 'the locale synchronization function must be present')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const followLocale = new AsyncFunction(
    'locale',
    'i18n',
    'orchestraPluginLanguage',
    '__ORCHESTRA_PLUGIN_ZH__',
    '__ORCHESTRA_PLUGIN_RU__',
    body
  )
  const events = []
  const bundles = new Map()
  const i18n = {
    language: 'en',
    hasResourceBundle: (language) => bundles.has(language),
    addResourceBundle(language, namespace, value) {
      assert.equal(namespace, 'translation')
      bundles.set(language, value)
      events.push(`register:${language}`)
    },
    async changeLanguage(language) {
      assert.ok(bundles.has(language), 'catalog must already be available')
      events.push(`change:${language}`)
      this.language = language
    }
  }
  await followLocale('ru-RU', i18n, selectLanguage, zh, ru)
  assert.deepEqual(events, ['register:ru', 'change:ru'])
  assert.equal(bundles.get('ru').orchestra.runView.workersTab, 'Исполнители и результаты')
  await followLocale('ru', i18n, selectLanguage, zh, ru)
  assert.deepEqual(events, ['register:ru', 'change:ru'])
})

test('the shipped panel contains the same Russian catalog as its build input', async () => {
  const panel = readFileSync(new URL('../panel.html', import.meta.url), 'utf8')
  assert.equal(panel.includes('\r'), false, 'the shipped panel uses consistent LF line endings')
  const start = panel.indexOf('function orchestraPluginLanguage(locale) {')
  const end = panel.indexOf('\n\t//#endregion', start)
  assert.ok(start > 0 && end > start, 'the shipped locale adapter must be present')
  let registered
  const i18n = {
    language: 'en',
    hasResourceBundle: () => false,
    addResourceBundle(language, namespace, value) {
      assert.equal(language, 'ru')
      assert.equal(namespace, 'translation')
      registered = value
    },
    async changeLanguage(language) {
      this.language = language
    }
  }
  const adapter = runInNewContext(
    `${panel.slice(start, end)}\n({ select: orchestraPluginLanguage, follow: followOrcaLocale })`,
    { i18n }
  )
  assert.equal(adapter.select('ru-RU'), 'ru')
  await adapter.follow('ru-RU')
  assert.equal(i18n.language, 'ru')
  assert.deepEqual(flatten(registered), flatten(ru))
})
