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
  absolute folder path. Switches the folder the Canvas window presents
  without leaving Canvas mode (`electron-browser/positronCanvasFolderSwitch.ts`).
  Refusals (not presenting, remote or multi-root window, missing or
  non-folder path, folder open in another window, untrusted folder or
  untrusted folder behind a symlink, unsaved changes, a busy runtime
  session) reject before anything changes, with a message the assistant
  shows. Past that point the assistant's extension host is restarted and
  cannot see the result; failures are presented on a curtain in the Canvas
  window with Retry Canvas and Open Positron, and the command's promise
  settles only when that curtain comes down (resolved on success, rejected
  with the failure once the user leaves through Open Positron, or with a
  cancellation message when Canvas is closed mid-switch).
- `positron.experimental.failNextCanvasSwitchAt` - development aid, source
  builds only: `'detach' | 'commit' | 'restore'` makes that step of the
  next switch fail once, to exercise the failure card by hand.

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
mode. Two modules share the work. `PositronCanvasService.rebuild(between)`
owns the Canvas half: it takes the panel out of the Canvas window (a
read-only, never-serialized placeholder editor keeps the window alive), clears
the stored Canvas mode flag for the folder being left, runs `between`, then
asks the assistant for a fresh panel, moves it home, drops the placeholder and
sets the flag on the destination. Each half is staged and resumable, so a
retry after a failure picks up where it stopped. `CanvasFolderSwitcher` owns
the workspace half inside `between`: runtimes and extension hosts down; the
main process swaps the window's workspace identity in place
(`platform/workspaces/electron-main/positronFolderWorkspace.ts`, reached over
the `workspaces` channel, deciding identity the way an ordinary open does and
using the physical path only to detect a folder already open through an
alias); the renderer re-initializes its workspace and switches storage; the
source's editors close; backups move home; the destination's saved main
layout is applied; extension hosts come back up.

Ordering matters in that middle. The storage switch first saves the source's
live editor layout, so the source's editors are still open then and A reopens
as it was. Both editor-part memento listeners would treat the swap as "adopt
the stored layout" (closing the Canvas window among other things), so
`browser/positronEditorPartsLayout.ts` holds them off for exactly that call,
and the switcher applies the destination's main layout itself afterwards
(`EditorPart.applyStoredState`); the destination's saved auxiliary windows are
not restored, the same choice the boot-time sweep makes. The source's editors
are closed by the group that held them, so a destination editor sharing an
input is never touched, and they close while backups still address the
source and the backup tracker is suspended
(`services/workingCopy/electron-browser/positronBackupHandoff.ts`), so nothing
the source does can discard the destination's hot-exit backups; the tracker
then re-inventories the new home so a later quit keeps them too.

Exit and the native close button wait for an in-flight switch to settle
before handing back the IDE or releasing the application-wide claim: the
main-process identity commit cannot be cancelled, so the renderer finishes
matching it (or reloads if it cannot) before anything else happens. Open
Positron after a partial commit reloads through
`PositronCanvasService.reloadIntoIde`, which asks the main process for a
one-use "recover to the IDE" intent that the next boot honours ahead of the
stored flag and `canvas.openOnStartup`.

The IDE window stays hidden throughout, and the extension host restart makes
the workbench focus elements inside it. `browser/positronWindowFocus.ts`
suppresses the implicit "raise the window this element lives in" (and the
macOS `moveTop`) for windows Canvas mode has hidden; the element focus itself
still happens, so focus state inside the hidden IDE stays truthful.

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
