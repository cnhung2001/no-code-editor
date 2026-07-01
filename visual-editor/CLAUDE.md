# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
# Dev server (also compiles Lezer grammar first)
npm run dev

# Build library for distribution
npm run build-lib

# Type checking
npm run check:ts
npm run check:svelte

# Lint
npm run check:eslint

# Unit tests
npm run test:unit

# Run a single test file
npx vitest run src/path/to/file.test.ts

# Regenerate Lezer grammar only (needed after editing src/lib/grammar/div.grammar)
npm run build:grammar
```

> The grammar build step (`build:grammar`) must run before TypeScript/Svelte checks and before `dev`. It generates `src/lib/grammar/div.js` from `src/lib/grammar/div.grammar`.

## Architecture

### What this is

A **publishable Svelte 5 component library** (`@divkitframework/visual-editor`) that embeds a full visual editor for [DivKit](https://github.com/divkit/divkit) server-driven UI JSON. The library exports a single `DivProEditor` class used by consumers to mount the editor into a DOM element.

The dev entry (`src/dev.ts`) mounts the editor directly in the browser for local development.

### State management

All editor state lives in `src/lib/data/state.ts` (`State` class). It uses **Svelte writable/derived stores** — no external state library. Every mutation goes through a **Command** object (`src/lib/data/commands/`) which enables undo/redo. Calling `state.pushCommand(cmd)` executes the command and records it in the history stack.

Key stores on `State`:
- `customVariables` — user-defined variables (shared by Variable tab and Localization tab)
- `i18nMarkedVars` — `Set<string>` of variable names whose dict value is used for i18n
- `products` — IAP product definitions
- `timers` — timer objects
- `screenId`, `screenLabel` — metadata for the wrapper export format
- `previewProductPrices` — `Record<string, string>` of variable-id → price string, editor-only, injected as global DivKit variables at render time
- `divjsonStore` — derived store; always emits `{ screen_id, label, remote_layout, variables }` wrapper format
- `palette`, `tanker`, `tree`, `sources`

### Left panel tab system

The 6-tab sidebar is split into two components:
- `src/lib/components/LeftBar.svelte` — icon strip (56 px); sets the active `LeftBarTab`
- `src/lib/components/LeftPanel.svelte` — panel body; renders the active tab's component
- `src/lib/components/leftBarTypes.ts` — `LeftBarTab` union type

Tab → Component mapping:

| Tab | Component |
|-----|-----------|
| `components` | `NewComponent` + `Components` |
| `palette` | `Palette` |
| `variable` | `CustomVariables` |
| `timers` | `Timers` |
| `products` | `Products` |
| `localization` | `LocalizationEditor` |

### Variable / Localization relationship

`CustomVariables.svelte` manages all typed variables. Dict-type variables can be flagged as i18n by adding their name to `state.i18nMarkedVars`. The `LocalizationEditor.svelte` tab then filters `customVariables` to only the marked dicts and presents a per-locale editing UI. Both tabs write back through `ChangeCustomVariablesCommand`.

Localization key usage is detected by scanning the JSON for `@{getOptStringFromDict('KEY', varName, ...)}` patterns.

### Products (IAP)

`src/lib/components/Products.svelte` + `src/lib/data/products.ts` + `src/lib/data/commands/changeProducts.ts`. Products serialize to a JSON array; the internal `__id` field (editor-only) is stripped on export via `productToJson()`.

### App context

Components access shared services via Svelte context key `APP_CTX` (defined in `src/lib/ctx/appContext.ts`). The context provides:
- `state` — the `State` instance
- Dialog APIs (`color2Dialog`, `actions2Dialog`, etc.)
- File upload, translation APIs, locale list

### Command pattern

All state-changing operations implement `BaseCommand` (`src/lib/data/commands/base.ts`):
- `do()` / `undo()` for reversibility
- `canMerge()` / `mergeMeWith()` to collapse rapid sequential edits (e.g. typing) into one history entry
- `toLangKey()` for localized undo/redo button labels

### JSON round-trip

- `state.setDivJson(json)` — parses incoming DivKit JSON and populates all stores. Accepts both plain DivKit JSON and the wrapper format `{ screen_id, label, remote_layout, variables }`.
- `state.treeToShortObject()` — serializes the component tree back to DivKit JSON
- `state.toFullDivjson()` — full export including templates, variables, timers, products, palette
- `state.divjsonStore` — derived store that always emits the wrapper format `{ screen_id, label, remote_layout }`. `Renderer.svelte` unwraps it: `$divjsonStore.object.remote_layout ?? $divjsonStore.object`.

**i18n auto-detection**: On `setDivJson`, all dict-type variables are scanned against `@{getOptStringFromDict('KEY', varName, ...)}` patterns in `card.states` to auto-populate `i18nMarkedVars`. No naming convention required.

### DivKit client library

The renderer (`Renderer.svelte`) renders using `@divkitframework/divkit/client` from `../client/web/divkit`. Key facts:

- Extensions receive **raw (unevaluated) params** from JSON. To resolve `@{...}` expressions, call `context.processExpressions(this.params)` synchronously in `mountView`, or use `context.derviedExpression(value)` for a reactive subscription. Both only work if the variable exists in `context.variables` (i.e. was declared as a global variable when calling `render()`).
- `Renderer.svelte` injects global variables before calling `render()`: `language_code`, `theme`, one string variable per product in `previewProductPrices` (keyed by `product.id`), palette fallback, and source variables.
- The Lottie extension is at `src/lib/data/lottieExt.ts`. If `lottie_url` contains an unresolvable `@{...}` expression the animation silently fails; a `gif_url` pointing to a real `.gif` file is the recommended fallback.

### Grammar

`src/lib/grammar/div.grammar` is a [Lezer](https://lezer.codemirror.net/) grammar used by CodeMirror for syntax highlighting and autocomplete in the JSON code panel. Changes require running `npm run build:grammar`.
