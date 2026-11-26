---
paths:
  - src/vs/workbench/contrib/positron*/browser/**/*.tsx
  - src/vs/workbench/contrib/positron*/browser/**/*.ts
  - src/vs/workbench/browser/positronComponents/**/*.tsx
  - src/vs/base/browser/ui/positronComponents/**/*.tsx
---

# Building Positron panes

How to choose and write scrolling for a new pane, view, or editor, and what else to check before review. Positron panes do not all scroll the same way, and that is fine when there is a reason. State the choice and the reason in the PR description so reviewers can check it.

## Pick a starting point

Start from what the pane shows, not from a scrolling technique:

| What the pane shows | Use | Copy |
|---|---|---|
| A list with fixed row heights | `PositronList` | Packages pane |
| A tree with fixed row heights | `PositronTree` | Data Connections pane (`positronDataConnections/`) |
| A table | `PositronDataGrid` | Data Explorer, `InlineDataExplorer.tsx` |
| Free-form content: text, output, rows of different heights | An `overflow: auto` element the browser scrolls | Console |
| Rendered HTML or other web content | A webview | Help pane |
| None of these | No ready option | Discuss with the team first |

### Lists, trees, and tables

`PositronList` (`src/vs/workbench/browser/positronList/`), `PositronTree` (`src/vs/workbench/browser/positronTree/`), and `PositronDataGrid` (`src/vs/workbench/browser/positronDataGrid/`) are Positron's own components. Only the rows or cells currently on screen exist in the page. The component tracks how far the user has scrolled and draws the matching rows, so it handles any amount of content, including tables with millions of rows. They also bring their own scrollbars, wheel handling that works on web, and keyboard scrolling.

Rows must have fixed heights (a list can have one height for items and another for section headers). Follow the `positron-data-grid-pattern` skill when you use them. A short list can also use a plain `overflow: auto` element (see Free-form content).

Examples to copy:

- List: `positronPackages/browser/components/listPackages.tsx`.
- Tree: `positronDataConnections/`.
- Full table editor: the Data Explorer.
- Table inside other scrolling content, such as a notebook: `positronNotebook/browser/notebookCells/InlineDataExplorer.tsx`. At the edge of the table, the wheel scrolls the surrounding content instead.

Never use `react-window`. Positron plans to remove it as a dependency. Variables and History still use it and need to move off it, so do not copy their list code. Use `PositronList` or `PositronTree` instead. If neither fits, discuss it with the team rather than adding a new `react-window` list.

### Free-form content

Let the browser scroll an `overflow: auto` element, and add all three of these:

- **Wheel on web:** `onWheel={keepWheelFromWorkbench}` (`src/vs/workbench/browser/positronWorkbenchWheel.ts`), as in `consoleInstance.tsx`. See [Why the wheel fails on web](#why-the-wheel-fails-on-web).
- **Scrollbar styling:** `::-webkit-scrollbar` rules scoped to the pane's own class. See `consoleInstance.css`.
- **Scroll position when the pane is hidden:** subscribe to `IReactComponentContainer.onSaveScrollPosition` and `onRestoreScrollPosition`, and use `DOM.saveParentsScrollTop` and `restoreParentsScrollTop`. See `variablesInstance.tsx`. The pane's view class implements `IReactComponentContainer` and passes itself to the React component, as `PositronHistoryViewPane` does in `positronHistoryView.tsx`.

If new content arrives at the bottom, decide whether the view should follow it. The console keeps the view at the bottom unless the user scrolls up, which the code calls scroll lock (`consoleInstance.tsx`). If the content can grow without limit, cap it, as the console does with its scrollback size setting.

No shared component does this yet. Console, Variables, and History each handle some of these pieces by hand, and not consistently: History has no wheel fix. If you are about to repeat it again, create a shared React component in `src/vs/base/browser/ui/positronComponents/` that renders the `overflow: auto` element and handles all three. Keep the browser doing the scrolling (see [Avoid](#avoid)).

Test wheel and trackpad scrolling in a web build (see the `drive-positron-web` skill), not only on desktop.

### Web content

Rendered HTML, such as Help and the Markdown preview, lives in a webview: a separate page inside an iframe that scrolls itself. Wheel events inside it never reach the workbench, so the web wheel problem does not apply.

### None of these

Some needs have no ready building block in Positron:

- Marks drawn on the scrollbar, like the editor's error and search marks.
- Several views that scroll together, like the two sides of a diff.
- Content that is neither rows nor a table but too large to put on the page.

If an existing VS Code editor already does the job, such as the diff editor, embed it. Otherwise, discuss the design with the team before you build.

## Avoid

- **Wrapping VS Code's scroll widget around React content.** This means `DomScrollableElement` or `SmoothScrollableElement`. Positron's `Scrollable` component (`src/vs/base/browser/ui/positronComponents/scrollable/Scrollable.tsx`) does this for the plot view only. Do not reuse it, and do not write another wrapper like it. Wrapping causes two problems:
  - **React loses track of its element.** React remembers where each element it rendered sits on the page and uses that record to update or remove it later. The widget moves the element into a wrapper of its own without telling React. When React later updates or removes the element, it looks in the old place. The result is an error, or old content left on the page. The plot view hit this, which is why `dynamicPlotInstance.tsx` adds an extra wrapper div around `Scrollable`.
  - **The scrollbar goes stale unless someone re-measures.** The widget only learns the content's size when told to re-measure (`scanDomNode()`). In React, content can change size from any child re-rendering, and the wrapper cannot see those changes. If the wrapper misses one, the scrollbar shows the wrong size or cannot reach the end of the content. The Welcome page hit this: upstream's getting-started editor (`gettingStarted.ts`) wraps Positron's React welcome page in `DomScrollableElement`, and the scrollbar went stale until a resize observer was added (posit-dev/positron#16024). Re-measuring on every render instead, as `Scrollable` does, forces the browser to recalculate the layout on every update, which slows down panes that update often.

  Embedding a VS Code widget is fine when the widget owns its own DOM and React renders nothing inside it, such as the code editor in the console input or the diff editor.
- **Scrolling the element yourself with `scrollBy(e.deltaX, e.deltaY)`.** That ignores line-based wheel deltas, smooth scrolling, trackpad momentum, and Shift+wheel.
- **Calling `preventDefault()` in a React `onWheel` handler.** React registers its wheel listener as passive (a promise to the browser never to cancel the event), so the browser ignores the call. If you really need to cancel a wheel event, use a native listener with `{ passive: false }`, as `dataGridWaffle.tsx` does.
- **Unscoped `::-webkit-scrollbar` rules.** They change every scrollbar in the app.

## Known scrolling bugs

These are bugs to fix, not patterns to copy. If your change touches one, fix it or work around it on purpose, and say which in the PR.

- **History and Runtime Sessions do not scroll with the wheel on web.** Neither calls `keepWheelFromWorkbench`. Confirmed for History in a web build: dragging the scrollbar works, but a trackpad scroll does nothing. Runtime Sessions is a developer-only pane with the same setup.
- **Variables sets app-wide scrollbar CSS.** `variablesInstance.css` has `::-webkit-scrollbar` rules with no selector in front, including `height: 0`. That hides horizontal browser scrollbars across the app wherever another rule does not override it: a test scroll box in Positron Web had a horizontal scrollbar 0 pixels tall, and 15 pixels once `height: 0` was turned off. This likely explains the missing horizontal scrollbar in Plots (posit-dev/positron#2507), which led to `Scrollable`. Scope these rules to the Variables pane.
- **The data grid handles navigation keys in `onKeyDown`.** `PositronList`, `PositronTree`, and the Data Explorer inherit keys users cannot rebind (see [keybindings.md](keybindings.md)). Use these components anyway. Fix it once in the data grid, not in each pane.

## Background

### Why the wheel fails on web

On Positron Web, `BrowserWindow` (`src/vs/workbench/browser/window.ts`) calls `preventDefault()` on every wheel event that reaches the workbench. It does this so a sideways two-finger swipe on macOS does not navigate the browser back a page. It also stops the browser from scrolling any `overflow: auto` element inside the workbench. Desktop does not have this listener.

`keepWheelFromWorkbench` stops the wheel event at the pane, so it never reaches that listener and the browser scrolls the pane normally. It lets Ctrl+wheel and pinch through, so the listener still cancels them and they do not zoom the page. Over those panes, a CSS rule takes over the swipe protection. `overscroll-behavior: none` on `.monaco-workbench.web` tells the browser not to pass leftover scrolling up to the page, where it would turn into a back swipe.

### Why VS Code scrolls in code

VS Code's views, lists, trees, and editors scroll through its own widget (`src/vs/base/browser/ui/scrollbar/scrollableElement.ts`). The widget reads wheel events, tracks the scroll position itself instead of leaving it to the browser, and draws its own scrollbars. VS Code does not document why. These are the needs it meets that browser scrolling does not:

- **Very large content.** The editor draws only the visible lines of files with millions of lines. Browsers cap how tall an element can be, and the browser moves content before code can draw the newly visible part, which shows as blank flashes during fast scrolling.
- **A scrollbar that shows more than position.** The editor's overview ruler marks errors, search matches, and git changes on the scrollbar.
- **Several views moving together.** The minimap, both sides of the diff editor, and sticky scroll follow one scroll position.
- **Control over the wheel.** Sensitivity settings, Alt+wheel fast scrolling, smooth scrolling, and locking a mostly vertical gesture to one axis.
- **The same scrollbars everywhere.** Themed colors, a shadow when content scrolls under a header, and hiding when the mouse leaves, in every browser.

The widget comes in two forms. `DomScrollableElement` wraps existing DOM and re-measures it when told to (`scanDomNode()`). `SmoothScrollableElement` measures nothing; the caller gives it the content size and draws only what is visible, which is how VS Code's lists and editor work. Both need a DOM element they control, which is why they do not fit around React content (see [Avoid](#avoid)).

## Do the upstream scroll settings apply?

VS Code's lists and trees (Explorer, Extensions) follow `workbench.list.mouseWheelScrollSensitivity`, `workbench.list.fastScrollSensitivity` (Alt+wheel), and `workbench.list.smoothScrolling`. The settings are wired up in `src/vs/platform/list/browser/listService.ts`. No Positron pane follows them today, whichever approach it uses.

If the pane is list-like and users would expect it to behave like Explorer, decide whether it should follow these settings, and say so in the PR.

## Can users change the pane's keybindings?

If the pane responds to keys, follow [keybindings.md](keybindings.md) so users can see and rebind its keyboard actions in the Keyboard Shortcuts editor.
