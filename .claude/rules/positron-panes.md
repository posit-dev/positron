---
paths:
  - src/vs/workbench/contrib/positron*/browser/**/*.tsx
  - src/vs/workbench/contrib/positron*/browser/**/*.ts
  - src/vs/workbench/browser/positronComponents/**/*.tsx
---

# Building Positron panes

Questions to answer when you build a new pane, view, or editor, or change how an existing one scrolls or handles keys.

There is no single right way for a Positron pane to scroll. Different panes have different needs, and using different approaches is fine when there is a reason for it. This file lists the approaches, what each one costs, and the questions that point to one. State the choice and the reason in the PR description so reviewers can check it.

## Who scrolls the content?

Positron uses three approaches today:

- **The browser.** The pane is an `overflow: auto` element and the browser moves its content. Used by the Console, Variables, Notebook, Connections, Runtime Sessions, History, Packages, and others.
- **VS Code's scroll widget** (`src/vs/base/browser/ui/scrollbar/scrollableElement.ts`). The widget reads wheel events, keeps the scroll position as a number, and draws its own scrollbars. VS Code's own views, lists, trees, and editors use it. It comes in two forms:
  - `DomScrollableElement` wraps ordinary DOM content and measures it when you call `scanDomNode()`. VS Code's view panes use it. Positron uses it through the React wrapper `Scrollable` (`src/vs/base/browser/ui/positronComponents/scrollable/Scrollable.tsx`) in the plot pan-and-zoom view.
  - `SmoothScrollableElement` does not measure anything. You tell it the content's size with `setScrollDimensions()`, listen to `onScroll`, and draw only what is visible. VS Code's lists (`src/vs/base/browser/ui/list/listView.ts`) and the text editor work this way, which is how they handle millions of rows or lines whose size changes all the time.
- **Custom code.** The Data Explorer grid has its own scrollbars and wheel handler (`src/vs/workbench/browser/positronDataGrid/`). It shows tables with millions of rows and columns, so it draws only the cells on screen and tracks the scroll position as numbers. `SmoothScrollableElement` follows the same pattern, so check whether it covers your case before writing new scrolling code. Custom code is the most code to write and maintain.

### Why VS Code scrolls in code

VS Code does not document a reason. These are the needs its widget meets that browser scrolling does not, and they are a useful checklist for a new pane:

- **Very large content.** The editor draws only the visible lines of files with millions of lines. Browsers cap how tall an element can be, and the browser moves content before your code can draw the newly visible part, which shows as blank flashes during fast scrolling. Keeping the scroll position as a number avoids both.
- **A scrollbar that shows more than position.** The editor's overview ruler (`src/vs/editor/browser/viewParts/overviewRuler/`) marks errors, search matches, and git changes on the scrollbar. A browser scrollbar cannot draw on itself.
- **Several views moving together.** The minimap, both sides of the diff editor, and sticky scroll follow one scroll position.
- **Control over the wheel.** Sensitivity and smooth-scrolling settings, Alt+wheel fast scrolling, locking a mostly vertical gesture to one axis (`scrollPredominantAxis`), and telling a mouse wheel from a touchpad (`MouseWheelClassifier`).
- **The same scrollbars everywhere.** Themed colors, a shadow when content scrolls under a header, and hiding when the mouse leaves, in every browser and operating system.

The cost is that every part of the UI has to go through the widget and keep it informed about size. UI built outside it, such as browser-scrolled React panes and webviews, behaves differently.

### Choosing an approach

These questions sort most panes:

- **Does the pane need any of the needs listed above?** The editor needs nearly all of them, and the Data Explorer needs very large content. A pane that needs none of them strongly, such as the Console or Variables, is a reasonable fit for browser scrolling.
- **Who keeps track of the content's size?** `DomScrollableElement` must be told to measure again each time the content changes size (`scanDomNode()`). That suits a zoomed plot, whose size changes only on zoom. It suits a console poorly, because the console grows with every line of output. With `SmoothScrollableElement` you supply the size yourself, which suits content you draw yourself.
- **Does the pane depend on things the browser gives for free?** For example `react-window`, the browser's `scroll` events, keyboard scrolling of a focused element, or `scrollIntoView`. If so, browser scrolling is the easier fit.

### Writing the scrolling code

Start from an existing component or pane instead of writing scrolling from scratch.

- **A list or tree with fixed row heights:** use `PositronList` (`src/vs/workbench/browser/positronList/`) or `PositronTree` (`src/vs/workbench/browser/positronTree/`). They are built on the data grid, so they handle wheel scrolling on web, scrollbars, and keyboard scrolling. Copy the Packages pane (`positronPackages/browser/components/listPackages.tsx`) for a list and the Data Connections tree (`positronDataConnections/`) for a tree. Follow the `positron-data-grid-pattern` skill.
- **A table:** use `PositronDataGrid` with a `DataGridInstance`. Copy the Data Explorer for a full editor, or the notebook's `InlineDataExplorer.tsx` for a table inside other scrolling content.
- **Free-form content** (text, output, rows of different heights): use a plain `overflow: auto` element with all three of these:
  - `onWheel={keepWheelFromWorkbench}`, so the wheel works on web.
  - Scrollbar CSS scoped to the pane's own class.
  - Scroll position saved and restored through `IReactComponentContainer.onSaveScrollPosition` and `onRestoreScrollPosition`, with `DOM.saveParentsScrollTop` and `restoreParentsScrollTop`. Variables shows the pattern (`variablesInstance.tsx`).

  No shared component exists for this case yet. Console, Variables, and History each repeat these three things by hand. If you are about to repeat them again, create a shared component in `src/vs/base/browser/ui/positronComponents/` instead: a React component that renders the `overflow: auto` element and handles the wheel, scrollbar styling, and saving and restoring the position. Let the browser keep doing the scrolling. Do not build it by wrapping VS Code's scroll widget (see Avoid below).
- **react-window:** Variables, Connections, and History use it. For a new list, prefer `PositronList`. If you need react-window, copy Variables, not History. History is about 1,500 lines of workarounds for rows of different heights, sticky headers, and focus.

Avoid:

- Wrapping `DomScrollableElement` (or `Scrollable`) around React-rendered content. It moves the element React rendered, and it must re-measure whenever the content changes. Wrapping VS Code widgets is fine when the widget owns its own DOM and React renders nothing inside it, as with the code editor in the console input.
- An `overflow: auto` element without `keepWheelFromWorkbench`. It does not scroll with the wheel on web.
- Calling `preventDefault()` in a React `onWheel` handler. React's wheel listener is passive, so the browser ignores the call. Use a native listener with `{ passive: false }`, as the data grid does (`dataGridWaffle.tsx`).
- Unscoped `::-webkit-scrollbar` rules. They change every scrollbar in the app.

### Known scrolling bugs

These are bugs to fix, not patterns to copy. If your change touches one, fix it or work around it on purpose, and say which in the PR.

- **Variables sets app-wide scrollbar CSS.** `variablesInstance.css` has `::-webkit-scrollbar` rules with no selector in front, including `height: 0`. That hides horizontal browser scrollbars across the app wherever another rule does not override it. Scope these rules to the Variables pane.
- **`Scrollable` moves React's DOM and re-measures on every render.** It appends its widget's node to the parent of the element React rendered, so `dynamicPlotInstance.tsx` wraps it in an extra `display: contents` div that React can remove. Its sizing effect depends on `props.children`, which is a new object on every render, so it calls `scanDomNode()` on every render.
- **Some browser-scrolled panes do not scroll with the wheel on web.** History is confirmed in a web build: dragging the scrollbar works, but a trackpad scroll does nothing. Connections and Runtime Sessions use `overflow: auto` with no `keepWheelFromWorkbench` either, so they likely have the same bug, but they have not been tested.
- **The data grid handles keys in `onKeyDown`.** Arrow keys, Home, End, PageUp, and PageDown are matched directly, so `PositronList` and `PositronTree` inherit keys users cannot rebind. See [keybindings.md](keybindings.md).

### If the browser scrolls the pane, handle the wheel on web

On Positron Web, `BrowserWindow` (`src/vs/workbench/browser/window.ts`) calls `preventDefault()` on every wheel event that reaches the workbench, to stop the macOS swipe from navigating back. That also stops the browser from scrolling any `overflow: auto` element inside the workbench. Desktop does not have this listener, so the bug only shows up on web.

Call `keepWheelFromWorkbench` (`src/vs/workbench/browser/positronWorkbenchWheel.ts`) from the scrolling element's `onWheel`. It stops the event before it reaches that listener, and leaves Ctrl+wheel and pinch alone so they still cannot zoom the page.

Do not scroll the element yourself with `scrollBy(e.deltaX, e.deltaY)`. That ignores line-based wheel deltas, smooth scrolling, touchpad momentum, and Shift+wheel.

Test wheel scrolling in a web build (see the `drive-positron-web` skill), not only on desktop.

## Do the upstream scroll settings apply?

VS Code's lists and trees (Explorer, Extensions) follow `workbench.list.mouseWheelScrollSensitivity`, `workbench.list.fastScrollSensitivity` (Alt+wheel), and `workbench.list.smoothScrolling`. The settings are wired up in `src/vs/platform/list/browser/listService.ts`. They do not reach other uses of `ScrollableElement`, and they do not reach browser-scrolled panes.

If the pane is list-like and users would expect it to behave like Explorer, decide whether it should follow these settings, and say so in the PR. A pane built on VS Code's list or tree widgets gets them automatically. Any other pane has to read the settings itself or leave them unsupported.

## Can users change the pane's keybindings?

If the pane responds to keys, follow [keybindings.md](keybindings.md) so users can see and rebind its keyboard actions in the Keyboard Shortcuts editor.
