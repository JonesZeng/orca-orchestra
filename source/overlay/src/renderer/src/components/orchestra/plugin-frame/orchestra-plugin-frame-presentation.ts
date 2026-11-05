import { i18n } from '@/i18n/i18n'

/** Injected by config/scripts/orchestra-plugin/build.mjs: the zh strings this panel renders. */
declare const __ORCHESTRA_PLUGIN_ZH__: Record<string, unknown> | undefined

/** The frame CSS variables Orca keeps in sync with its active theme (plugin-theme-tokens.md). */
const ORCA_FRAME_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'radius'
] as const

/** Point Orca's own tokens at the frame variables; tokens Orca does not send keep the bundled theme. */
export function followOrcaFrameTheme(root: HTMLElement = document.documentElement): void {
  const styles = getComputedStyle(root)
  for (const token of ORCA_FRAME_TOKENS) {
    if (styles.getPropertyValue(`--orca-${token}`).trim()) {
      root.style.setProperty(`--${token}`, `var(--orca-${token})`)
    } else {
      root.style.removeProperty(`--${token}`)
    }
  }
}

/** Orchestra ships English and Simplified Chinese; Traditional Chinese reads the English source. */
export function orchestraPluginLanguage(locale: string): 'zh' | 'en' {
  return /^zh(?!-(hant|tw|hk|mo)\b)/i.test(locale) ? 'zh' : 'en'
}

export async function followOrcaLocale(locale: string): Promise<void> {
  const language = orchestraPluginLanguage(locale)
  if (language === 'zh' && !i18n.hasResourceBundle('zh', 'translation')) {
    const catalog = typeof __ORCHESTRA_PLUGIN_ZH__ === 'object' ? __ORCHESTRA_PLUGIN_ZH__ : {}
    i18n.addResourceBundle('zh', 'translation', catalog, true, true)
  }
  if (i18n.language !== language) {
    await i18n.changeLanguage(language).catch(() => undefined)
  }
}
