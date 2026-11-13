# Positron editor actions

## Dedicated Assistant window

Posit Assistant can show a conversation in its own window, with Assistant's conversation tabs and no Positron chrome.
Positron owns the window; Assistant owns what's in it, the same split as Canvas (`../positronCanvas/README.md`).

The window is compact for good (`lockCompact`) and its editor group is locked, like a Canvas window.
`AssistantWindowGuard` (`browser/positronAssistantWindow.ts`) moves any other editor that opens there to the main window, since the window has no tabs to reach it.

### Contract with Posit Assistant

The names below are shared with the assistant repo; change them in both places.

Registered by Positron, called by the assistant:

- `positron.assistantWindow.open`: opens an empty dedicated Assistant window, locks its group, and resolves its column as an extension `ViewColumn`. The assistant creates its window panel in that column (an explicit column still opens in a locked group), so the panel never shows in the main window first. It then calls `enter`. If no panel arrives within 15 seconds, or `enter` finds the panel somewhere else, the empty window closes.
- `positron.assistantWindow.enter`: moves the active editor, which must be an Assistant window panel, into a dedicated Assistant window. Not in the palette; the assistant makes the panel active first. Resolves `true` when the panel ends up in a dedicated window (including when it was already in one, such as a window from `open`), `false` otherwise. The assistant checks the command exists and falls back to its older "Open in New Window" path when it doesn't.

Registered by the assistant:

- View type `posit-assistant.window`: the whole of window-panel identity. Positron recognizes a window panel by this view type alone (`isAssistantWindowEditor` in `browser/parts/editor/positronAuxiliaryWindowOptions.ts`). A window panel shows Assistant's own conversation tabs for its whole life.
