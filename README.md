# Cobalt Note

Cobalt Note is an experimental notebook-style editor built around small note editors and a notebook controller.

This repository is now organized as an npm-workspaces monorepo. The code is still TypeScript in this step; the next migration step is to convert the packages to approachable JavaScript once the package boundaries have settled.

## Packages

```text
packages/
  note-core/        Shared low-level DOM/selection/geometry helpers.
  rich-text-note/   The current Cobalt rich text note editor.
  notebook/         Generic notebook coordination logic.
  example-app/      Browser examples using the packages.
```

### `@muze-labs/cobalt-note-core`

Contains reusable low-level browser helpers that future note types may need:

- DOM selection to text offsets
- text offsets to DOM selection
- caret geometry
- nearest offset lookup from a client coordinate
- word/paragraph range helpers

This is where complex selection/cursor handling should gradually move so custom note authors do not have to reimplement it.

### `@muze-labs/cobalt-rich-text-note`

Contains the current fragment-based rich text note editor:

- fragments and annotations
- commands
- registry
- rendering
- clipboard support
- the `edit(element, fragment)` note editor

The editor emits a bubbling `cobalt:change` event after an operation changes its
text or annotations, once rendering and selection restoration are complete:

```js
import { edit, RICH_TEXT_NOTE_CHANGE_EVENT } from '@muze-labs/cobalt-rich-text-note';

element.addEventListener(RICH_TEXT_NOTE_CHANGE_EVENT, (event) => {
    const fragment = event.detail.fragment;
    // Map this detached value into your app's data model or local draft store.
    saveDraft(fragment);
});
const editor = edit(element, { text: '', annotations: [] });
```

Notifications are synchronous and contain a detached `{ text, annotations }`
snapshot. Typing, deletion, newlines, paste, cut, formatting and mutating editor
API calls (including `setValue`) use the same event. Mounting, equivalent values,
no-op edits, focus, selection decorations and pending typing styles do not emit
changes. `destroy()` stops notifications. Mutating the supplied fragment directly
is not an observed editing API; use the editor methods instead.

Storage and RDF mapping remain application responsibilities. Applications should
queue asynchronous saves in order, handle failures, and avoid treating a
`setValue` notification during restoration as a new user edit. Async listener
completion is not awaited by the editor. TypeScript consumers can use the exported
`RichTextNoteChangeDetail` type for `CustomEvent`.

### Native text composition

IME and composing phone-keyboard input stays under the browser's control until
`compositionend`. At that point Cobalt applies the committed text through its
normal fragment commands, preserves surrounding annotations and emits one
`cobalt:change` for an actual change. Provisional candidates do not trigger
saves. Cancellation with unchanged text emits no change.

`editor.isComposing()` reports unfinished native input. Hosts should defer
closing, saving a final snapshot, switching to a passive view or destroying an
editor while it returns `true`. `getValue()` still returns the last committed
fragment during composition. An explicit API edit supersedes the pending native
composition; its later end cannot overwrite that newer value. Destroying the
editor removes listeners and intentionally discards unfinished input.

The implementation follows [UI Events composition events](https://www.w3.org/TR/uievents/#events-compositionevents)
and [Input Events Level 2 composition ordering](https://www.w3.org/TR/input-events-2/#input-event-order-during-composition).
It does not cancel composing input or rely on the relative ordering of
`compositionupdate` and `beforeinput`. Empty `compositionend.data` can mean
cancellation or deletion, so the final DOM text determines the change.

### `@muze-labs/cobalt-notebook`

Contains generic notebook coordination logic:

- notebook-level selection
- cross-note cursor movement
- cross-note selection decorations
- pointer selection support

It talks to notes through a `NotebookNoteAdapter`, so future note types do not need to be based on the rich text note editor.

### `@muze-labs/cobalt-example-app`

Contains the current browser examples. The app owns notebook-level shortcuts, the note list, and focus after structural changes. Each note owns its local keyboard interpretation and can emit an intent event such as `cobalt:request-remove-note`; the app decides whether to perform that operation.

## Build

From the repository root:

```bash
npm install
npm run build
```

The examples import from the package `dist/` directories, so run the build before opening them.

The root `package-lock.json` locks the shared workspace installation used by the
example app and its build/test tools. Individual library packages do not keep
separate lockfiles.

## Run the examples

```bash
npx serve -l 8080 packages/
```

Then open:

- `http://localhost:8080/example-app/`
- `http://localhost:8080/example-app/notebook.html`

## Next planned refactors

1. Extract more generic helpers into `@muze-labs/cobalt-note-core`.
2. Clarify and document the `NotebookNoteAdapter` contract.
3. Add a second simple note type to test whether the adapter is generic enough.
4. Convert packages from TypeScript to simple JavaScript with JSDoc for public APIs.

## TODO

- Validate annotation attributes and link destinations in the rich-text renderer.
  It currently escapes fragment text but emits recognized annotation tags with
  their stored attributes unchanged. Keep this responsibility in Cobalt so the
  editor and consuming apps share the same behavior; margin-notes should only
  bind the renderer's output. Deferred for now (2026-10-30).
