# Visión y meta de DevPanel

## La meta

> **Que los desarrolladores automaticen su trabajo sin necesidad de salir de DevPanel.**

Todo lo que se añada a DevPanel se mide contra esa frase: si obliga a abrir otra herramienta (el navegador, el IDE, una terminal suelta, un panel de CI), todavía no está terminado.

## Cómo se reparte el trabajo

| Capa | Tecnología | Rol |
| --- | --- | --- |
| Interfaz | Electron + TypeScript | Lo que ve y toca el desarrollador |
| Cerebro | Python (`python/`) | Calcula la salud de los proyectos, analiza código y commits, y alimenta a la IA y a las automatizaciones |
| Músculo (opcional) | Go | Servicio ligero en segundo plano que vigila repos, builds y procesos, y ejecuta automatizaciones sin depender de que Python esté instalado. Solo se añade cuando haga falta un vigilante siempre activo |

## Alcance

**Ya existe**
- Repos de GitHub: commits, PRs, issues y Actions, con reintento de builds fallidos.
- Proyectos locales: git (fetch, pull, push, commit, ramas), scripts de npm, recetas de Flutter y Firebase, comparación de idiomas y búsqueda de secretos.
- Claude Code como chat dentro de la app, ligado a un proyecto registrado.
- Catálogo e instalador de software, notas, alertas, actualizaciones y login facial.
- **Project Health**: puntuación 0-100 por proyecto (local o de GitHub) calculada en Python, con un resumen (`brief`) pensado para alimentar a la IA.

**Hacia dónde va**
1. **Leer documentos como un IDE.** Abrir y navegar archivos del proyecto (código, Markdown, JSON, configuración) dentro de DevPanel, con resaltado de sintaxis, búsqueda, vista de diferencias y salto desde un error o un commit al archivo. Solo lectura primero; edición después.
2. **Automatizaciones.** Reglas del tipo "cuando pase X, haz Y" (build fallido, salud por debajo de un umbral, PR abierto, cambios sin subir) que corren sin salir de la app.
3. **IA con contexto real.** Claude recibe el resumen de salud, el estado de git y los documentos abiertos para proponer y ejecutar acciones sobre el proyecto.
4. **Salud en todas partes.** Historial de la puntuación, alertas cuando baja y sugerencias de arreglo con un clic.
5. **Vigilante en Go.** Observa los repos y dispara automatizaciones con la ventana cerrada.

## Principios

- **Seguro por defecto.** Solo se toca lo que el usuario registró, los comandos son una lista fija y nunca se commitean secretos.
- **Sin salir de la app.** Cada acción termina en DevPanel, con su resultado visible.
- **Útil antes que vistoso.** El diseño sigue la guía de UI/UX del proyecto: accesible, con foco visible, `prefers-reduced-motion` respetado y modo claro y oscuro.
- **Sin dependencias obligatorias.** El usuario final no necesita instalar Python ni Go: se empaquetan.
