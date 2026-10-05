import { app } from 'electron';
import { loadSettings } from './settings';

// Only the few strings the main process shows itself (tray menu, notifications).
// Everything shown inside the window is translated in the renderer.
const EN: Record<string, string> = {
  'Abrir DevPanel': 'Open DevPanel',
  'Buscar actualizaciones': 'Check for updates',
  'Avisarme si falla un build': 'Notify me when a build fails',
  'Mostrar / ocultar': 'Show / hide',
  'Salir': 'Quit',
  'Build fallido': 'Build failed',
  'El último workflow terminó con errores': 'The latest workflow finished with errors',
  'en': 'on',
  'Haz clic para verlo.': 'Click to view it.',
};

export function isEnglish(): boolean {
  const pref = loadSettings().language;
  if (pref === 'en') return true;
  if (pref === 'es') return false;
  return !app.getLocale().toLowerCase().startsWith('es');
}

/** Translates a Spanish source string when the app language is English. */
export const mt = (es: string): string => (isEnglish() ? (EN[es] ?? es) : es);
