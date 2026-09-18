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

## Opening another folder from Canvas (experimental)

Two `positron.experimental.*` commands back Posit Assistant's Canvas
workspace picker. They are experimental because their shape may still
change with the picker; the assistant degrades to a static workspace name
when they are absent.

- `positron.experimental.getCanvasFolders(): Promise<string[]>` - the local
  folders in the recently opened list, most recent first, as absolute paths.
- `positron.experimental.switchCanvasFolder(absolutePath: string): Promise<void>`
  - loads `absolutePath` into the Canvas window and boots that load into
  Canvas. This is an ordinary folder load, not an in-place switch: the
  window's document is replaced the way File > Open Folder replaces it, so
  the new folder gets fresh storage, backups, extension hosts, and runtime
  sessions, and Canvas goes away and comes back.

What the caller can rely on:

- The initial preflight changes nothing. Every refusal there rejects with a
  localized, user-presentable message and leaves sessions, storage and
  windows as they were: AI disabled, Canvas not presenting, a remote or
  multi-root source, a relative path, a missing or non-folder path, a
  folder already open in another window (checked on the logical and the
  physical path, so a symlink alias cannot slip past), an untrusted
  destination (both paths again; the trust prompt renders in the hidden IDE
  and is refused rather than asked), unsaved editors, or a runtime session
  that is busy or not settled (starting, restarting, exiting, offline,
  interrupting). Requesting the current folder through any name is a no-op.
- Then the runtime sessions are shut down one by one, from the live list,
  in at most two passes. A refusal after that point (a session that turned
  busy or arrived meanwhile, a shutdown that failed or was declined, the
  folder changing, an unload veto) also rejects with a localized message,
  but it is not a no-op: sessions already shut down stay shut down, and the
  message names the session that stopped the request, not the ones already
  gone. The folder itself, its storage and its Canvas mode flag are untouched.
- The promise resolves when the main process has accepted the window's
  unload and started loading the new folder. The calling extension host
  disappears with the old document, so the caller cannot await Canvas
  readiness in the new folder and should not treat a missing response as a
  failure.
- On rejection while this window is alive, Canvas is put back as it was on
  screen: its window shown, the IDE window hidden again, the loading cards
  gone. "As it was" means the presentation, not the runtime state (see the
  previous point). If Canvas was closed or exited while that was happening,
  the IDE the close or exit revealed stays visible instead.
- If the load fails after the unload was already accepted (the window's
  workbench has shut down by then; a backup or profile setup error), the
  main process reloads the window into the folder it came from, as the
  IDE, since nothing is left in that document to present the failure.

What the user sees: a loading card over Canvas and over the IDE window, the
covered IDE window shown and the Canvas window put away, then the ordinary
window load (a plain themed background instead of the IDE layout skeleton),
then the new folder's own Canvas startup curtain (`CanvasStartupBoot`) with
its Retry / Open Positron / Show Logs / Quit. A Canvas startup failure in
the new folder is therefore the existing startup failure, not a switch
failure; Open Positron lands in the new folder. That includes a new folder
whose own settings turn `ai.enabled` off: the explicit Canvas intent still
puts the curtain up, and the entry fails into its card
(`shouldPresentCanvasStartup`); AI is not enabled against the setting.

Mode persistence: the folder being left stops relaunching into Canvas (its
stored intent is removed inside the accepted load's state save, and only
for a load; quitting or closing in Canvas keeps it), and the new folder
records Canvas mode as any successful Canvas entry does. The load carries a
one-use `--canvas` intent (`CanvasLaunchWindowAssigner`); an explicit
`canvas.openOnStartup: false` on the destination still yields Canvas for
that one load, and a later ordinary relaunch follows the setting.

Where the pieces live: `electron-browser/positronCanvasFolderSwitch.ts`
(commands and preflight), `IPositronCanvasService.openFolderWithLoadingPresentation`
(presentation and shutdown bookkeeping), `platform/workspaces/*/positronFolderWorkspace.ts`
(the resolver and the main-process open seam on the `workspaces` channel), and
`platform/windows/electron-main/positronCanvasFolderOpen.ts` (the three
routing decisions `IOpenConfiguration.positronCanvasFolderOpen` adds to the
ordinary open: exact target, no reuse of a window already on the folder,
awaited unload).

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
