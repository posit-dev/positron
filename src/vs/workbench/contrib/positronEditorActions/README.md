# Positron editor actions

## Dedicated Assistant window

Posit Assistant can show a conversation in its own window, with Assistant's conversation tabs and no Positron chrome.
Positron owns the window; Assistant owns what's in it, the same split as Canvas (`../positronCanvas/README.md`).

The window is compact for good (`lockCompact`) and its editor group is locked, like a Canvas window.
`AssistantWindowGuard` (`browser/positronAssistantWindow.ts`) moves any other editor that opens there to the main window, since the window has no tabs to reach it.

### Contract with Posit Assistant

The names below are shared with the assistant repo; change them in both places.

Registered by Positron, called by the assistant:

- `positron.assistantWindow.open`: opens an empty dedicated Assistant window, locks its group, and resolves its column as an extension `ViewColumn`. The assistant creates its window panel in that column (an explicit column still opens in a locked group), so the panel never shows in the main window first. A panel created there needs no `enter`. The assistant calls `open` only when it is about to create a new window panel (not when it reuses one), so the window doesn't sit empty.
- `positron.assistantWindow.enter`: used for a window panel the assistant reuses (or one that isn't in its window yet). Moves the active editor, which must be an Assistant window panel, into a dedicated Assistant window. Not in the palette; the assistant makes the panel active first. Resolves `true` when the panel ends up in a dedicated window (including when it was already in one, such as a window from `open`), `false` otherwise. The assistant checks the command exists and falls back to its older "Open in New Window" path when it doesn't.

Registered by the assistant:

- `posit-assistant.moveToWindow`: "Move (or Copy) Editor into New Window" for a single Assistant chat tab (palette, tab menu, editor action bar) calls this instead of moving the tab, after making the tab active (`moveAssistantTabToWindow` in `browser/parts/editor/positronAuxiliaryWindowOptions.ts`). The assistant opens a window panel with the tab's conversation (through `open`, or `enter` for one it reuses), then closes the tab. Resolves `false` when it did nothing, and Positron moves the tab itself; an older assistant without the command gets the compact window as before.
- View type `posit-assistant.window`: the whole of window-panel identity. Positron recognizes a window panel by this view type alone (`isAssistantWindowEditor` in `browser/parts/editor/positronAuxiliaryWindowOptions.ts`). A window panel shows Assistant's own conversation tabs for its whole life.
