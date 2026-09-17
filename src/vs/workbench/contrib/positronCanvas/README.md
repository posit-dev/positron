# Positron Canvas mode

Canvas mode presents Posit Assistant's Canvas panel as the whole product: one
conversation in a chromeless standalone window, with the IDE window hidden.
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

Registered by Positron, called by the assistant, experimental (the
`positron.experimental.*` prefix says the shape may still change with the
assistant's workspace picker; an assistant that finds neither command keeps a
fixed workspace name):

- `positron.experimental.getCanvasFolders` - plain command; the local folders
  in the recently opened list, most recent first, as absolute paths. The
  assistant's picker lists these.
- `positron.experimental.switchCanvasFolder` - plain command taking an
  optional absolute folder path; without one it shows a native folder dialog
  over the Canvas window. Switches the folder the Canvas window presents
  without leaving Canvas mode (`electron-browser/positronCanvasFolderSwitch.ts`).
  Refusals (not presenting, remote or multi-root window, missing or
  non-folder path, folder open in another window, untrusted folder, unsaved
  changes) reject before anything changes, with a message the assistant shows.
  Past that point the assistant's extension host is restarted and cannot see
  the result; failures are presented on a curtain in the Canvas window with
  Retry Canvas and Open Positron.

Registered by Positron for its own UI and launch integration:

- `positron.canvas.open` - Canvas editor-action command, also targeted by a
  forwarded `--canvas` launch. Same service call as `positron.canvas.enter`,
  but it owns the failure notification. Deliberately absent from the palette:
  a Canvas-capable assistant owns discovery through its
  `posit-assistant.openCanvas` command, so older assistants expose nothing.

Registered by the assistant, called by Positron:

- `posit-assistant.ensureCanvas` - ensures the singleton Canvas panel,
  resolving only when its UI is ready and rejecting when Canvas is unavailable
  or failed. Positron invokes it before trusting even a restored panel.
- View type `posit-assistant.canvas` - the whole of Canvas-panel identity;
  `PositronCanvasService` recognizes a Canvas by `providerId` alone.
- Output channel label `Posit Assistant` - the startup curtain's "Show Logs"
  resolves the assistant's output channel by this display label
  (`ASSISTANT_OUTPUT_CHANNEL_LABEL` in `positronCanvas.contribution.ts`).
  Renaming the channel on the assistant side silently reroutes Show Logs to
  the window log until the constant catches up.

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

## Switching folders inside Canvas

A Canvas window can take on another local folder without leaving Canvas
mode. The main process swaps the window's workspace identity in place
(`platform/workspaces/electron-main/positronFolderWorkspace.ts`, reached over
the `workspaces` channel); the renderer then re-initializes its workspace,
storage and backups, restarts runtimes and extension hosts, and asks the
assistant to rebuild Canvas in the same auxiliary window. The stored Canvas
mode flag moves with the folder: cleared on the one being left before its
storage closes, set on the destination once Canvas is back. Only local,
single-folder, already-trusted destinations are accepted; trust is not
prompted for because the prompt renders in the hidden IDE window.

Two upstream reflexes would undo the switch and are held off while Canvas
presents. The editor parts treat an external change to their stored layout
(which is what a workspace storage switch looks like) as "adopt this layout":
close every auxiliary window, restore the new folder's saved ones. The Canvas
window is an auxiliary window, so `browser/positronEditorPartsLayout.ts` lets
the Canvas service ask `EditorParts` to leave auxiliary windows alone; the main
part still adopts the new folder's own layout, and the switch empties the
hidden IDE's editors first so the result matches a fresh open. The other
reflex is focus: the IDE window stays hidden throughout, and the extension
host restart makes the workbench focus elements inside it. `browser/positronWindowFocus.ts`
suppresses the implicit "focus the window this element lives in" (and the
macOS `moveTop`) for windows Canvas mode has hidden, so those focus calls do
not reveal the IDE mid-switch.

## Workspace trust at boot

The workspace trust startup prompt renders in the main window, which Canvas
mode hides, and an undecided workspace holds back trust-gated extensions -
including the authentication providers behind the Canvas model picker. Boot
therefore waits for the trust decision behind the curtain before entering
Canvas (`browser/positronCanvasTrustGate.ts`): the curtain's z-index sits
below workbench dialogs, so the prompt (a workbench dialog, not a native one)
shows over it and Canvas proceeds on either answer. The prompt itself belongs
to the workbench's own startup trust handler; the gate waits for that handler
to initiate it and joins the resulting request rather than raising a dialog
of its own, with a bounded grace period so drift in the mirrored conditions
delays boot instead of hanging it. When no prompt is coming (trust disabled,
already trusted, or suppressed by setting or an earlier answer), the gate
stays out of the way and an untrusted Canvas is the assistant's
restricted-mode surface to explain. Trust stays stock workbench UI; it is
deliberately not plumbed through the command seam.
