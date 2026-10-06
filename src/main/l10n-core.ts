// Translation-file comparison (pure, no Electron/fs imports: unit-testable).

/** Folders where Flutter/web apps usually keep their translation files. */
export const L10N_DIRS = [
  'assets/translations', 'assets/lang', 'assets/i18n', 'assets/locales', 'assets/l10n',
  'lib/l10n', 'lib/localization', 'lib/i18n', 'src/locales', 'src/i18n', 'locales', 'i18n',
];

export interface LocaleFile {
  lang: string;
  file: string;
  keys: string[];
}

/** { a: { b: 1 }, c: 2 } -> ["a.b", "c"] (arrays count as leaves). */
export function flattenKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return prefix ? [prefix] : [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k));
}

/** ARB files keep metadata under "@key" and "@@locale": those are not translations. */
export function arbKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((k) => !k.startsWith('@'));
}

/** "en.json" -> "en", "es-ES.json" -> "es-ES", "app_pt_BR.arb" -> "pt_BR", "intl_en.arb" -> "en". */
export function langOf(fileName: string): string {
  const base = fileName.replace(/\.(json|arb)$/i, '');
  const m = base.match(/(?:^|[_-])([a-z]{2,3}(?:[_-][A-Za-z]{2,4})?)$/);
  return m ? m[1] : base;
}

export interface L10nReport {
  languages: string[];
  /** number of distinct keys across all languages */
  total: number;
  /** keys present in some language but absent from this one */
  missing: Record<string, string[]>;
  /** total of missing keys over all languages */
  missingCount: number;
}

export function compareLocales(files: LocaleFile[]): L10nReport {
  const all = new Set(files.flatMap((f) => f.keys));
  const missing: Record<string, string[]> = {};
  let missingCount = 0;
  for (const f of files) {
    const have = new Set(f.keys);
    const gone = [...all].filter((k) => !have.has(k)).sort();
    if (gone.length) {
      missing[f.lang] = gone;
      missingCount += gone.length;
    }
  }
  return { languages: files.map((f) => f.lang), total: all.size, missing, missingCount };
}
