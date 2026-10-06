/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Every fact about Positron's UI that the helpers depend on, in one place, so a
// change in the product is one edit here and a drift check can find it in src/.
//
//   css    DOM selectors, for what the accessibility tree does not carry. The
//          note beside each says what the tree lacks. Plain roles and tags
//          ([role=grid], img) stay in the code: they are the tree. Key suffixes
//          mark values that are not whole selectors: ...TestId is a data-testid
//          prefix, ...Class a class-name prefix, ...Attr an attribute name,
//          ...Var a CSS custom property.
//   names  Accessible names and command titles the helpers find things by:
//          buttons, menu items, toolbars, regions, view headings and Command
//          Palette titles ("Category: Title"). A key ending in Pattern is a
//          regular expression source. Text the helpers only interpret after
//          finding an element (status words, label formats) stays beside the
//          code that parses it.
//
// How each kind of code reads them:
//   page functions  lib.css and lib.names (inPage passes this file's values to
//                   makeLib, since page code is serialized and cannot import).
//                   A function passed to evaluate() takes the group it needs as
//                   its argument: page.evaluate(s => ..., lib.css.console).
//   Node code       import { css, names } from './selectors.ts'.
//   bash recipes    eval "$(node selectors.ts names)" defines group_key
//                   variables ($plots_previous); `node selectors.ts css GROUP...`
//                   prints {GROUP: {...}} as JSON for a script that builds page
//                   code (quickpick-enum.sh, monaco-paste.sh).
//
// To add one: put it in the group of its area with a why-note, and read it from
// there; never repeat the string in a helper.

export const css = {
	// ---- Workbench: parts, views, focus. Parts and panes have no landmark role
	// or accessible name to tell them apart.
	part: {
		sidebar: '.part.sidebar',
		secondary: '.part.auxiliarybar',
		panel: '.part.panel',
		editor: '.part.editor',
		statusbar: '.part.statusbar',
	},
	workbench: {
		root: '.monaco-workbench', // the element to give focus to when taking it out of a webview; no role
		sash: '.monaco-sash', // part edges to drag: not in the tree at all
		sashHorizontal: '.monaco-sash.horizontal',
		sashVertical: '.monaco-sash.vertical',
		sashDisabled: '.monaco-sash.disabled',
		tabLabel: '.action-label', // a panel tab's label; its accessible name runs on into a badge's ("Problems (\u21E7\u2318M) - Total 4 Problems")
	},
	view: {
		pane: '.pane', // a view's pane: the tree gives its heading, not the box around header and body
		paneHeader: '.pane .pane-header',
		// Per-session instances stacked under the active one: laid out, not aria-hidden,
		// marked only by an inline z-index (lib.unstack hides them from the tree).
		stacked: '[style*="z-index: -1"]',
	},

	// ---- Overlays: what opens on top. Positron's own dialogs and menus have no
	// dialog or menu role, so roles alone miss them.
	overlay: {
		dialog: '[role=dialog], .positron-modal-dialog-box, .monaco-dialog-box',
		notInNotifications: ':not(.notifications-toasts *):not(.notifications-center *)', // a toast is a dialog too
		notInToasts: ':not(.notifications-toasts *)',
		any: '[role=dialog], [role=menu], .quick-input-widget', // what an action can open (ui.sh "opened")
		menu: '.context-view .monaco-menu, .custom-context-menu-items, [role=menu], .drop-down-list-box-items',
		notifications: '.notifications-toasts, .notifications-center',
		modal: '.positron-modal-overlay, .context-view', // what holds focus while a Positron menu or popup is open; no role
	},
	quickInput: {
		// Closed widgets stay in the DOM; the live one is the visible one. Its rows
		// are a virtual list moved by a transform (references/reading-ui-state.md).
		widget: '.quick-input-widget',
		filter: '.quick-input-box input',
		list: '.quick-input-list',
		rows: '.quick-input-list .monaco-list-row',
		entry: '.quick-input-list-entry',
		rowCells: '.quick-input-list-rows > .quick-input-list-row',
		meta: '.quick-input-list-label-meta', // the detail line, which the row's name leaves out
		separator: '.quick-input-list-separator', // a heading drawn on the row below it, hidden but not cleared when recycled
		separatorRow: '.quick-input-list-separator-as-item', // a heading drawn as a row of its own
	},
	list: {
		row: '.monaco-list-row', // a row's index and state are not in the tree
		indexAttr: 'data-index', // the row's place in the whole list, not in the rows drawn
		focusedRow: '.monaco-list-row.focused',
		selected: '.selected',
	},
	label: {
		// A row's or tab's label and its grey description, which the tree runs together.
		name: '.label-name',
		description: '.label-description',
		icon: '.monaco-icon-label', // its aria-label holds a tab's full path
	},
	dialog: {
		// Modal dialogs, upstream and Positron's: message, detail and buttons as separate parts.
		box: '.monaco-dialog-box, .positron-modal-dialog-box, .positron-dynamic-modal-dialog-box',
		message: '.dialog-message-text, .simple-title-bar, .title-bar-title, .title',
		detail: '.dialog-message-detail, .content-area',
		buttons: '.dialog-buttons .monaco-button, .ok-cancel-action-bar button, button.action-bar-button, button.dialog-button',
		anyButton: 'button, .monaco-button',
	},
	notification: {
		// A toast's message, source, severity and buttons are one run of text in the tree.
		toasts: '.notifications-toasts',
		toast: '.notification-toast',
		center: '.notifications-center',
		rows: '.notification-toast .monaco-list-row, .notifications-center .monaco-list-row',
		icon: '.notification-list-item-icon', // its codicon class names the severity
		message: '.notification-list-item-message',
		source: '.notification-list-item-source',
		buttons: '.notification-list-item-buttons-container .monaco-button',
		clear: '.notification-toast .codicon-notifications-clear',
	},
	menu: {
		// Positron's context menu items are buttons, not menu items.
		items: '[role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], .custom-context-menu-item',
		cellItems: '[role=menuitem], [role=menuitemcheckbox], .custom-context-menu-item',
		sessionItems: '[role=menuitem], .custom-context-menu-item',
		treeItems: '.context-view .action-menu-item, .monaco-menu .action-menu-item, .custom-context-menu-item, [role=menu] [role=menuitem]',
		label: '.action-label', // an item's label without its icon glyph and shortcut
		keybinding: '.keybinding, [class*=keybinding], [class*=shortcut]',
	},
	checkbox: {
		// Positron's modal checkbox draws its mark and leaves aria-checked false.
		checkMark: '.check-indicator, .codicon-check',
	},

	// ---- Editors. Monaco draws lines, line numbers and decorations as
	// positioned divs with no roles.
	editorGroup: {
		group: '.editor-group-container', // groups have no role or name of their own
		active: '.editor-group-container.active',
		activeTab: '.tab.active',
		dirty: '.dirty', // a tab's unsaved mark: not in its accessible name
		actions: '.editor-actions', // the editor's action bar, beside the tabs: no toolbar role
	},
	monaco: {
		editor: '.monaco-editor',
		lineNumbers: '.margin-view-overlays .line-numbers',
		viewLines: '.view-lines',
		viewLine: '.view-line',
		drawnLine: '.view-lines .view-line',
		editContext: '.native-edit-context', // the element that takes Monaco's paste
		topFrameLine: '.view-overlays .debug-top-stack-frame-line',
		focusedFrameLine: '.view-overlays .debug-focused-stack-frame-line',
	},
	languageFeatures: {
		// Completions, hover and Go to Definition draw their states outside the tree.
		suggestMessage: '.suggest-widget .message', // "No suggestions." or "Loading...": not in the tree
		overlayMessage: '.monaco-editor-overlaymessage', // "No definition found for 'x'": announced, then gone; no role
		peek: '.peekview-widget', // Go to Definition with several results opens a peek; no name of its own
		peekTitle: '.peekview-title',
	},
	chat: {
		input: '.new-chat-input-area .native-edit-context', // monaco-paste.sh's target; the input has no accessible name
		sessionsInput: '.sessions-chat-editor .native-edit-context',
	},

	// ---- Consoles: one instance per session, all laid out; which is active, and
	// which session an instance belongs to, are not in the tree.
	console: {
		instance: '.console-instance',
		empty: '.empty-console', // the Console view with no session: its message has no role
		active: '.console-instance[style*="z-index: auto"]',
		container: '.console-instance-container', // the output, without the input
		input: '.console-input',
		inputEditContext: '.console-input .native-edit-context',
		inputLines: '.console-input .view-lines',
		prompt: '.console-input .line-numbers.active-line-number', // the prompt is drawn as Monaco's line number
		anyPrompt: '.console-input .line-numbers',
		busy: '.codicon-positron-interrupt-runtime', // a session is running code: the interrupt icon shows
		instanceTestId: 'console-', // + session id (python-1a2b3c4d)
		tabTestId: 'console-tab-', // + session id
	},
	terminal: {
		xterm: '.xterm', // drawn on a canvas; its text is read through the Accessible View
		visible: '.xterm:not(.terminal-sticky-scroll .xterm)', // without the sticky-scroll overlay, an xterm of its own
		input: '.xterm-helper-textarea',
		accessibleView: '.accessible-view',
		tabEntry: '.terminal-tabs-entry', // the terminal list's rows carry no index or selected state in the tree
	},

	// ---- Areas with their own helper.
	plots: {
		name: '.plot-name', // the header above a plot has no role; an image's alt is its code
		thumbnailName: '.plot-thumbnail-name', // the name under a thumbnail ("interactive 1"); an interactive plot's image alt is its id
		instance: '.plot-instance', // where an interactive plot's webview is laid over, outside the pane
		webview: 'iframe.webview',
		selected: '.selected', // a thumbnail's selected state, until the product sets aria-pressed
	},
	qmd: {
		// Quarto inline output lives in Monaco view zones, which Monaco hides from the tree.
		output: '.quarto-inline-output',
		outputWrapper: '.quarto-inline-output-wrapper',
		footerIcon: '.code-cell-footer-icon', // its class is the run status
		footerText: '.code-cell-footer-text',
		content: '.quarto-output-content',
		outputKindClass: 'quarto-output-', // + stdout, stderr, error, image, ...
		stateAttr: 'data-execution-state', // on the cell toolbar: its run state, not in its name
		executionIdAttr: 'data-execution-id', // on the cell toolbar: its last run's id, kept after the run; a cell with no output shows no other trace of a run
	},
	nb: {
		cellMargin: '.left-hand-action-container', // a click there selects a cell; focus alone does not
		kernelTestId: 'runtime-status-', // + idle, busy, ...: the kernel badge's state is not in its name
	},
	tree: {
		// Positron's trees are a grid with no rows, levels or expanded states in the tree.
		row: '.positron-tree-row',
		content: '.positron-tree-content',
		twisty: '.positron-tree-twisty',
		twistyClass: 'positron-tree-twisty-', // + expanded, collapsed, loading, leaf
		leaf: '.positron-tree-twisty-leaf',
		indent: '.positron-tree-indent', // the level is this element's width
		indentVar: '--positron-tree-indent-width',
		// Upstream trees, read the same way so one parser serves both.
		listRow: '.monaco-list-row[role=treeitem]',
		listContent: '.monaco-tl-contents',
		listTwisty: '.monaco-tl-twistie',
	},
	dataGrid: {
		// The Data Explorer's cells have no roles.
		row: '.data-grid-row',
		cell: '.data-grid-row-cell',
		headerTitle: '.title',
		status: '.status-bar, [class*=status-bar]',
	},
};

export const names = {
	palette: {
		startConsole: 'Interpreter: Start New Console Session',
		focusConsole: 'Console: Focus on Console View',
		focusTerminal: 'Terminal: Focus on Terminal View', // with no terminal, showing the view makes one
		openAccessibleView: 'Open Accessible View', // its key goes to the shell in a terminal
		positronChangeKernel: 'Positron Notebook: Change Kernel...',
		changeKernel: 'Notebook: Change Kernel...',
		selectKernel: 'Notebook: Select Notebook Kernel',
		focusBreakpoints: 'Run and Debug: Focus on Breakpoints View',
		toggleBreakpoint: 'Debug: Toggle Breakpoint',
		addConditionalBreakpoint: 'Debug: Add Conditional Breakpoint...',
		addLogpoint: 'Debug: Add Logpoint...',
		focusDebugConsole: 'Debug Console: Focus on Debug Console View',
		reloadWindow: 'Developer: Reload Window',
		openFolder: 'File: Open Folder...',
		newWindow: 'New Window', // no category: "File: New Window" is not a title
		selectSession: 'Interpreter: Select Session', // its picker lists every session: console, notebook and Quarto
		similarCommands: 'similar commands', // the heading over the palette's guesses when no command matches; Enter there runs one
	},
	views: {
		plots: 'Plots',
		viewer: 'Viewer',
		callStack: 'Call Stack',
		debugVariables: 'Debug Variables',
		watch: 'Watch',
		breakpoints: 'Breakpoints',
	},
	console: {
		selectSession: 'Select Session', // the title bar button that names the only session
		showTraceback: 'Show Traceback', // an error's collapsed traceback: its frames are not in the console's text until clicked
	},
	editor: {
		suggest: 'Suggest', // the completion list (a listbox of options)
		closePeek: 'Close', // the peek view's close button
		cursorStatusPattern: 'Ln (\\d+), Col (\\d+)(?: \\((\\d+) selected\\))?', // the status bar button
	},
	viewer: {
		url: 'The current URL',
		// A URL (an app, a site) gets the URL toolbar; HTML content (htmltools, a
		// widget) gets a smaller one whose reload and clear say "content".
		reload: 'Reload the current URL',
		reloadContent: 'Reload the content',
		back: 'Navigate back to the previous URL',
		forward: 'Navigate back to the next URL',
		clear: 'Clear the current URL',
		clearContent: 'Clear the content',
		interrupt: 'Interrupt execution', // shown only while an app runs
		openMenu: 'Select where to open',
		openInEditor: 'Open in Editor Tab',
		openInBrowser: 'Open in Browser',
	},
	plots: {
		previous: 'Show Previous Plot',
		next: 'Show Next Plot',
		clearAll: 'Clear All Plots',
		save: 'Save Plot',
		overflow: 'overflow',
		zoomPattern: '^(Fit|\\d+%)$', // the zoom menu's button is named after the zoom
		openMenu: 'Select where to open plot',
		openInEditor: 'Open in Editor Tab',
		openInWindow: 'Open in New Window',
		openWebviewInWindow: 'Open Plot in New Window', // an interactive plot's menu
		intrinsicSize: 'Use intrinsic size', // Save Plot's checkbox for a plot with a size of its own; it disables Width and Height
	},
	qmd: {
		cellActions: 'Quarto cell actions',
		run: 'Run this cell',
		stop: 'Stop cell execution',
		cancel: 'Cancel pending execution',
		moreActions: 'More cell actions', // opens Positron's context menu of the cell (its items are buttons)
		clearOutput: 'Clear output', // an output's own button; it reads Interrupt execution while the cell runs
	},
	nb: {
		cellActions: 'Cell actions',
		runCellPattern: '^(Run|Execute) Cell(\\s*\\(.*\\))?$',
		moreCellActions: 'More Cell Actions',
		moveUp: 'Move Cell Up',
		moveDown: 'Move Cell Down',
		restartKernel: 'Restart Kernel',
		stopExecution: 'Stop Execution',
		clearAllOutputs: 'Clear All Outputs',
		cellOutput: 'Cell output',
		renderedMarkdown: 'Rendered markdown content',
	},
	panel: {
		deleteSession: 'Delete', // a console tab's context menu
	},
	window: {
		ok: 'OK', // the simple file dialog's accept button (a quick input)
	},
	sessions: {
		// The session picker's group headings, and the description of the foreground session's row.
		consoleHeading: 'Console Sessions',
		notebookHeading: 'Notebook Sessions',
		quartoHeading: 'Quarto Sessions',
		currentlySelected: 'Currently Selected',
	},
	workbench: {
		additionalViews: 'Additional Views', // the one tab a narrow panel folds its tabs into; its menu lists the views
		compactModeOff: 'Turn Off Compact Mode', // a compact window's title bar button: such a window shows no tabs or editor buttons
	},
	runApp: {
		runPattern: '^Run\\b',
		appPattern: '\\bApp\\b',
	},
	debug: {
		continue: 'Continue',
		stepOver: 'Step Over',
		stepInto: 'Step Into',
		stepOut: 'Step Out',
		restart: 'Restart',
		disconnect: 'Disconnect', // R's stop button
		pause: 'Pause',
		stop: 'Stop',
		addExpression: 'Add Expression',
	},
};

export type Css = typeof css;
export type Names = typeof names;

/** How bash reads these: `names` as group_key='value' lines to eval, `css GROUP...` as JSON. */
if (import.meta.main) {
	const [what, ...groups] = process.argv.slice(2);
	const quote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
	if (what === 'names') {
		for (const [g, entries] of Object.entries(names)) {
			for (const [k, v] of Object.entries(entries)) { process.stdout.write(`${g}_${k}=${quote(v)}\n`); }
		}
	} else if (what === 'css' && groups.length && groups.every(g => g in css)) {
		process.stdout.write(JSON.stringify(Object.fromEntries(groups.map(g => [g, css[g as keyof Css]]))) + '\n');
	} else {
		process.stderr.write('selectors.ts: names, or css GROUP...\n');
		process.exitCode = 2;
	}
}
