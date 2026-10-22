// Short versions of docs/USAGE.md, PRIVACY.md, SECURITY.md and TERMS.md, shown before installing.
// Both languages live here (long paragraphs do not fit the Spanish->English lookup table).
import type { Lang } from './i18n.js';

export type LegalTab = 'use' | 'privacy' | 'security' | 'terms';

interface Section {
  title: string;
  items: string[];
}

export const LEGAL: Record<Lang, Record<LegalTab, { tab: string; sections: Section[] }>> = {
  es: {
    use: {
      tab: 'Uso',
      sections: [
        {
          title: 'Para qué sirve DevPanel',
          items: [
            'Es un panel para que los desarrolladores trabajen y automaticen tareas sin salir de la app.',
            'Inicio: builds fallando, pull requests, cambios locales y salud de proyectos, en paneles plegables.',
            'Projects: tus repos de GitHub con commits, PRs, issues y Actions.',
            'Local: carpetas de tu equipo con git, diagnóstico (npm, pnpm, yarn, bun, deno, Flutter), salud, búsqueda de secretos y un explorador de archivos de solo lectura.',
            'Tools: catálogo de software, utilidades, notas y el chat de Claude Code.',
          ],
        },
        {
          title: 'Cómo empezar',
          items: [
            'Vincula tu usuario de GitHub y crea un PIN de 4 dígitos. El rostro es opcional.',
            'Agrega las carpetas de tus proyectos en Local: solo se tocan las que tú registras.',
          ],
        },
      ],
    },
    privacy: {
      tab: 'Privacidad',
      sections: [
        {
          title: 'Todo queda en tu equipo',
          items: [
            'DevPanel no tiene servidores propios y no envía telemetría ni analíticas.',
            'Tu usuario de GitHub, tus notas y los ajustes se guardan como archivos locales.',
            'El token de GitHub (opcional) se cifra con el sistema y solo se envía a api.github.com.',
            'El PIN se guarda como un hash con sal, nunca en claro.',
            'El rostro (opcional) se guarda solo como vectores numéricos, sin imágenes, cifrados con el sistema, y se procesa localmente.',
          ],
        },
        {
          title: 'Con quién se comunica',
          items: [
            'GitHub, para leer tus repos y para descargar actualizaciones.',
            'winget, cuando instalas software del catálogo.',
            'Claude Code (opcional): si lo usas, recibe tu mensaje y un resumen breve de salud del proyecto, sin contenido de archivos, bajo las condiciones de tu cuenta de Anthropic.',
          ],
        },
      ],
    },
    security: {
      tab: 'Seguridad',
      sections: [
        {
          title: 'Cómo se protege',
          items: [
            'La ventana está aislada (sandbox, sin acceso directo al sistema).',
            'Solo se actúa sobre carpetas que tú registras y con una lista cerrada de comandos: git, tu gestor de paquetes con scripts que existen en el proyecto, y recetas fijas de Flutter y Firebase.',
            'El explorador es de solo lectura y no sale de la carpeta del proyecto.',
            'Un commit con claves o archivos .env se rechaza antes de ejecutarse.',
          ],
        },
        {
          title: 'Tu parte',
          items: [
            'Los ejecutables aún no están firmados: Windows SmartScreen puede avisar. Descarga DevPanel solo de GitHub Releases.',
            'Usa un token de GitHub de permisos mínimos y con vencimiento.',
            'Para reportar una vulnerabilidad, abre un aviso privado en la pestaña Security del repositorio.',
          ],
        },
      ],
    },
    terms: {
      tab: 'Términos',
      sections: [
        {
          title: 'Condiciones',
          items: [
            'DevPanel se distribuye bajo la licencia MIT.',
            'Se entrega tal cual, sin garantías. Los autores no responden por daños ni pérdida de datos.',
            'Tú eres responsable de los comandos y scripts de tus proyectos que DevPanel ejecuta por ti. Revisa su contenido y mantén copias de seguridad.',
            'GitHub, Anthropic, winget y otros servicios tienen sus propios términos. DevPanel no está afiliado a ellos.',
            'Documento informativo: no constituye asesoría legal. Versión completa en la carpeta docs del repositorio.',
          ],
        },
      ],
    },
  },
  en: {
    use: {
      tab: 'Use',
      sections: [
        {
          title: 'What DevPanel is for',
          items: [
            'A panel that lets developers work and automate tasks without leaving the app.',
            'Home: failing builds, pull requests, local changes and project health, in collapsible panels.',
            'Projects: your GitHub repos with commits, PRs, issues and Actions.',
            'Local: folders on your machine with git, diagnosis (npm, pnpm, yarn, bun, deno, Flutter), health, secret scan and a read-only file explorer.',
            'Tools: software catalog, utilities, notes and the Claude Code chat.',
          ],
        },
        {
          title: 'Getting started',
          items: [
            'Link your GitHub user and create a 4-digit PIN. Face login is optional.',
            'Add your project folders in Local: only the ones you register are ever touched.',
          ],
        },
      ],
    },
    privacy: {
      tab: 'Privacy',
      sections: [
        {
          title: 'Everything stays on your machine',
          items: [
            'DevPanel has no servers of its own and sends no telemetry or analytics.',
            'Your GitHub user, notes and settings are stored as local files.',
            'The GitHub token (optional) is encrypted by the system and only sent to api.github.com.',
            'The PIN is stored as a salted hash, never in clear text.',
            'The face (optional) is stored only as numeric vectors, no images, encrypted by the system, and processed locally.',
          ],
        },
        {
          title: 'Who it talks to',
          items: [
            'GitHub, to read your repos and to download updates.',
            'winget, when you install software from the catalog.',
            'Claude Code (optional): if you use it, it receives your message and a short project health summary, with no file contents, under the terms of your Anthropic account.',
          ],
        },
      ],
    },
    security: {
      tab: 'Security',
      sections: [
        {
          title: 'How it is protected',
          items: [
            'The window is isolated (sandbox, no direct access to the system).',
            'It only acts on folders you register, with a closed list of commands: git, your package manager with scripts that exist in the project, and fixed Flutter and Firebase recipes.',
            'The explorer is read-only and cannot leave the project folder.',
            'A commit containing keys or .env files is refused before it runs.',
          ],
        },
        {
          title: 'Your part',
          items: [
            'The executables are not signed yet: Windows SmartScreen may warn you. Download DevPanel only from GitHub Releases.',
            'Use a GitHub token with minimal permissions and an expiry date.',
            'To report a vulnerability, open a private advisory in the repository Security tab.',
          ],
        },
      ],
    },
    terms: {
      tab: 'Terms',
      sections: [
        {
          title: 'Conditions',
          items: [
            'DevPanel is distributed under the MIT license.',
            'It is provided as is, without warranties. The authors are not liable for damage or data loss.',
            'You are responsible for the commands and scripts of your projects that DevPanel runs for you. Review them and keep backups.',
            'GitHub, Anthropic, winget and other services have their own terms. DevPanel is not affiliated with them.',
            'Informational document: it is not legal advice. The full version is in the docs folder of the repository.',
          ],
        },
      ],
    },
  },
};

export const LEGAL_ORDER: LegalTab[] = ['use', 'privacy', 'security', 'terms'];
