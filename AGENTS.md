# VS Code Agents Instructions

This file provides instructions for AI coding agents working with the VS Code codebase.

For detailed project overview, architecture, coding guidelines, and validation steps, see the [Copilot Instructions](.github/copilot-instructions.md).

<!-- --- Start Positron --- -->
<!-- Positron-specific guidance for all coding agents. Kept below the upstream text to avoid merge conflicts. -->

## Accessibility

UI work aims for [WCAG 2.2 Level AA](https://www.w3.org/TR/WCAG22/) conformance, with particular attention to keyboard operability and screen reader support. Some of Positron's existing UI does not meet it yet, so treat this as a goal, not a requirement:

- **New UI** is built to conform from the start.
- **Changes to existing UI** must not make accessibility worse. If a nearby problem has a small, self-contained fix, fix it. Flag larger gaps instead of growing a small change into an accessibility rewrite.

The checks below are good defaults, not the only correct answers. Code that meets the same need another way is fine. When building or reviewing UI, check that:

- **Every control works from the keyboard.** A single control is a Tab stop. Inside a list, tree, grid, or tab set, the group is one Tab stop and the arrow keys move between items. Buttons activate with Enter and Space, links with Enter, and checkboxes with Space. Escape closes what the control opened. Only a modal dialog keeps focus inside itself. Everywhere else, Tab can move on.
- **Right-click menus open from the keyboard too.** Shift+F10 and the Menu key open the same menu. macOS does not fire `contextmenu` for those keys, so handle them in `onKeyDown` or with a keybinding. Windows and Linux do fire `contextmenu` for them, so make sure that the menu does not open twice.
- **Native elements come first.** Use `<button>`, `<input>`, `<a>`, and similar. Avoid click handlers on a `<div>` or `<span>`. One-off interactive `<div>` elements tend to miss keyboard support, an accessible name, or state. If a non-native element must be interactive, give it the role, `tabIndex`, name, and keys that its APG pattern lists.
- **Follow an established pattern.** Some widgets have no native element, such as a tab set, tree, grid, menu, listbox, combobox, or toolbar. For those, follow the matching pattern in the [WAI-ARIA Authoring Practices Guide (APG)](https://www.w3.org/WAI/ARIA/apg/patterns/). Each pattern lists the roles, states, and keys to use. Before you build one, look for a Positron component that already implements it, and reuse or extend it. If none exists and other UI can use it, build it as a shared component.
- **Do not disable the accessibility lint rules.** The ESLint config turns on `jsx-a11y` rules for `.tsx` files, for example `jsx-a11y/no-static-element-interactions`. When one fires, fix the markup instead of adding an `eslint-disable` comment. If the element is not a control, a disable is acceptable. An example is a wrapper that passes a key on to the focused widget inside it. The disable comment must say why.
- **Every control has an accessible name, said once.** If the control has visible text, that text is usually the name. Icon-only controls get a name from `aria-label`, `aria-labelledby`, or visually hidden text. Names are user-facing strings, so localize them. Hide decorative icons with `aria-hidden`. `role='presentation'` removes an element's role, but a screen reader still reads its text. If you set `aria-label`, include the visible label in it, because voice-control users say what they see. Then hide the inner text with `aria-hidden` so the name is not read twice.
- **ARIA attributes match the real state.** `aria-checked`, `aria-expanded`, `aria-invalid`, and `aria-disabled` follow the control's current state, not its first render. A collapsed control sets `aria-expanded='false'` instead of removing the attribute. Use `aria-selected` for the selected item in a list, tab set, or grid, and `aria-current` for the current page or step. A toggle button can use `aria-pressed`, or `role='switch'` with `aria-checked`. Link each label to its input with `htmlFor`, or wrap the input in the `<label>`.
- **Hidden content is out of reach.** Content the user cannot see must not be reachable with Tab or read by a screen reader. Pick the method by how the content is hidden:
	- Not needed now: do not render it, or hide it with `display: none`, `visibility: hidden`, or the `hidden` attribute. All of these already remove it from the Tab order and from screen readers.
	- Kept rendered to keep its state, but out of view: set `inert` on its container. Examples are a console stacked behind the active one and a welcome page slide moved off screen. `inert` covers every element inside it. Disabling `<button>` and `<input>` elements one by one misses interactive `<div>` and `<a>` elements.
	- `aria-hidden` alone is not enough, because focusable elements inside it stay in the Tab order. Moving content off screen, `opacity: 0`, and `z-index` hide it only from sight.
	- This rule does not apply to text hidden from sight on purpose for screen readers, such as a visually hidden label or a live region.
- **Focus has somewhere to go.** If the focused element goes away, move focus somewhere sensible. For a restarted console, that is its replacement. For a deleted session, it is the next or previous item. For a closed dialog or menu, it is the control that opened it.
- **Toolbars start from the action bar components.** The components are in `src/vs/platform/positronActionBar/browser/components/`. They make the toolbar one Tab stop, with arrow keys to move between controls. They also set `aria-haspopup` on menu buttons. Upstream's `ActionBar` is fine in code that does not use React.
- **Keyboard users see what mouse users see.** A hover that shows on mouse enter also shows on keyboard focus, and Escape dismisses it. Keep the default focus outline. If you replace it, use `var(--vscode-focusBorder)`.
- **Important changes out of view are announced.** If an important change happens away from the user's focus, announce it. Use `status()` or `alert()` from `vs/base/browser/ui/aria/aria.js`, or an `aria-live` region. Do not announce routine updates.
- **Color is never the only signal.** Pair it with text or an icon, and use theme color variables so high contrast themes apply. High contrast themes leave many background colors undefined. If an active or selected state uses only a background color, add an outline with `var(--vscode-contrastActiveBorder)`. Only high contrast themes set that color.
- **Contrast is high enough.** Text has a contrast ratio of at least 4.5:1 against its background. Icons and control borders have at least 3:1.
- **Tests find elements the way assistive technology does.** In React Testing Library, prefer `getByRole` with a `name` over test IDs or class selectors. A test that can find a control by role and name also checks that a screen reader can. To inspect the shared controls by hand, run **Developer: Open Control Gallery** from the Command Palette.

<!-- --- End Positron --- -->
