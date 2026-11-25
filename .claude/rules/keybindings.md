---
paths:
  - src/vs/workbench/contrib/positron*/**/*.ts
  - src/vs/workbench/contrib/positron*/**/*.tsx
  - src/vs/workbench/browser/positron*/**/*.ts
  - src/vs/workbench/browser/positron*/**/*.tsx
  - src/vs/base/browser/ui/positron*/**/*.tsx
---

# Keybindings

Positron keyboard actions work with VS Code's keybinding system. Users can find every action in the Keyboard Shortcuts editor, give it a new key, and the new key does the action. This applies to panes, editors, dialogs, notebooks, and any other UI that responds to keys.

## Register keyboard actions as commands

Register each keyboard action as a command with a keybinding:

- `registerAction2` with a `keybinding` in the action's options, or
- `KeybindingsRegistry.registerCommandAndKeybindingRule`.

Scope the keybinding with a `when` clause, usually a context key that is true while the UI has focus (for example `PositronVariablesFocused`). The command's handler does the work. The UI calls the command, or a shared function the command also calls, and does not repeat the logic.

## Avoid these patterns

- **Matching keys in `onKeyDown`.** A `switch (e.key)` in a React handler is invisible to the Keyboard Shortcuts editor, and users cannot rebind it.
- **Registering a keybinding with an empty handler while `onKeyDown` does the work.** The Variables pane does this for expand, collapse, and copy (`positronVariables.contribution.ts`, `handler: () => { }`, with the real logic in `keyDownHandler` in `variablesInstance.tsx`). The binding appears in the Keyboard Shortcuts editor, but rebinding it does nothing, because `onKeyDown` still checks the original key.

Navigation keys are included. VS Code's own lists register arrow keys, Home, End, PageUp, and PageDown as commands (`list.focusDown`, `list.focusPageDown`, and others in `src/vs/workbench/browser/actions/listCommands.ts`), so users can rebind them. UI built on VS Code's list or tree widgets gets those commands automatically.

## Known bugs

These are bugs to fix, not patterns to copy:

- **Variables** registers expand, collapse, and copy with empty handlers and does the work in `onKeyDown`, as described above.
- **The data grid** (`src/vs/workbench/browser/positronDataGrid/components/dataGridWaffle.tsx`) matches arrow keys, Home, End, PageUp, and PageDown in `onKeyDown`. Everything built on it inherits this: the Data Explorer, `PositronList`, `PositronTree`, and the panes that use them.

## Exceptions

Keys with a fixed meaning set by the operating system or by accessibility standards can be handled directly. Examples are Tab and Shift+Tab to move focus, and Shift+F10 or the Menu key to open a right-click menu (see [accessibility.md](accessibility.md)). Text inputs and editors that receive typed characters also handle those characters directly.
