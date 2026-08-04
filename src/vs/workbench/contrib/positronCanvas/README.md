# Positron Canvas mode

Canvas mode presents Posit Assistant's Canvas panel as the whole product: one
conversation in a chromeless standalone window, with the IDE window minimized.
Positron owns windows, groups, focus, and the mode transaction; the assistant
owns Canvas content, panel identity, singleton-ness, and UI readiness. When a
new command is needed in either direction, ask which side owns the fact, not
which side finds it convenient to act.

## The command seam

The cross-repo subset below also lives in the assistant repo at
`packages/positron/src/frontend-canvas/README.md`; change that subset in both
places. Positron's full public namespace is pinned by
`test/electron-browser/positronCanvasCommands.vitest.ts`.

Registered by Positron, called by the assistant:

- `positron.canvas.enter` - plain command, the assistant's API into Canvas
  mode. Returns a `CanvasEntryOutcome` (`common/positronCanvasMode.ts`) and
  never notifies; presentation belongs to the caller.
- `positron.canvas.exit` - palette action, deliberately unbound: Escape is
  pressed constantly in a chat UI, and a chord that swaps the whole product
  surface is worse than no shortcut. The user-facing way out is the Canvas
  top bar's "Open Positron" control. Resolves `true` only when it actually
  left Canvas mode; the assistant treats anything else as a failed exit.
- `positron.canvas.isActive` - plain command; whether Canvas is the only
  visible surface. Gates the Canvas UI's "Open Positron" control.

Registered by Positron for its own UI:

- `positron.canvas.open` - Canvas editor-action command. Same service call as
  `positron.canvas.enter`, but it owns the failure notification. Deliberately
  absent from the palette: a Canvas-capable assistant owns discovery through
  its `posit-assistant.openCanvas` command, so older assistants expose nothing.

Registered by the assistant, called by Positron:

- `posit-assistant.ensureCanvas` - ensures the singleton Canvas panel,
  resolving only when its UI is ready and rejecting when Canvas is unavailable
  or failed. Positron invokes it before trusting even a restored panel.
- View type `posit-assistant.canvas` - the whole of Canvas-panel identity;
  `PositronCanvasService` recognizes a Canvas by `providerId` alone.
