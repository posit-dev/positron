# Positron Canvas mode

Canvas mode presents Posit Assistant's Canvas panel as the whole product: one
conversation in a chromeless standalone window, with the IDE window minimized.
Positron owns windows, groups, focus, and the mode transaction; the assistant
owns Canvas content, panel identity, singleton-ness, and UI readiness. When a
new command is needed in either direction, ask which side owns the fact, not
which side finds it convenient to act.

## The command seam

Everything the two sides know about each other. The same list lives in the
assistant repo at `packages/positron/src/frontend-canvas/README.md`; change
them together. The registered set is pinned by
`test/electron-browser/positronCanvasCommands.vitest.ts`.

Registered by Positron, called by the assistant:

- `positron.canvas.enter` - plain command, the assistant's API into Canvas
  mode. Returns a `CanvasEntryOutcome` (`common/positronCanvasMode.ts`) and
  never notifies; presentation belongs to the caller.
- `positron.canvas.open` - palette action, also the target of a forwarded
  `--canvas` launch. Same service call, but it owns the failure notification,
  because its callers have no other surface to hear about one.
- `positron.canvas.exit` - palette action, deliberately unbound: Escape is
  pressed constantly in a chat UI, and a chord that swaps the whole product
  surface is worse than no shortcut. The user-facing way out is the Canvas
  top bar's "Open Positron" control. Resolves `true` only when it actually
  left Canvas mode; the assistant treats anything else as a failed exit.
- `positron.canvas.isActive` - plain command; whether Canvas is the only
  visible surface. Gates the Canvas UI's "Open Positron" control.

Registered by the assistant, called by Positron:

- `posit-assistant.openCanvasInline` - produces the (singleton) Canvas panel,
  resolving when its UI is ready and rejecting on failure.
- View type `posit-assistant.canvas` - the whole of Canvas-panel identity;
  `PositronCanvasService` recognizes a Canvas by `providerId` alone.

## Loading surfaces

Two deliberate layers, not duplication:

- Positron's startup curtain (`canvasStartupPresenter.ts`) covers the IDE
  while Canvas starts. It speaks as Positron ("Canvas could not start") and
  owns Retry / Open Positron / Quit, because it can reach the IDE and the
  application lifecycle.
- The assistant's webview bootstrap (static HTML, then
  `CanvasBootstrapSurface`) covers the conversation loading inside the Canvas
  window. It speaks as Canvas and owns Retry only.

Keep the split: the curtain never talks about conversations, the webview
never offers a way out of Canvas mode besides the top bar's Open Positron.
