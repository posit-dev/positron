/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The bridge reads the DOM of a third-party app in the Viewer, which Positron
// didn't build and has no element references into, so it has to use selectors.
/* eslint-disable no-restricted-syntax */

import type { IViewerBridge, IViewerIdleOptions, IViewerIdleResult, IViewerSnapshot, IViewerSnapshotOptions, IViewerViewport } from '../common/positronViewerAgent.js';

/**
 * The name of the global that caches the bridge in the app's window on
 * Desktop, where each call is a separate script run in the app's frame.
 */
const BRIDGE_GLOBAL = '__positronViewerBridge1';

/**
 * Returns a script that runs one bridge method in the app's own frame and
 * resolves to `{ ok: true, value }` or `{ ok: false, error }`. Used on
 * Desktop, where the Viewer's app frame is cross-origin from Positron and
 * code can only reach it through the main process.
 *
 * @param method The bridge method to call.
 * @param args The method's arguments; must be JSON-serializable.
 */
export function viewerBridgeScript(method: keyof IViewerBridge, args: readonly unknown[]): string {
	// The bridge is sent as source, so it must not refer to anything outside
	// its own body (see createViewerBridge).
	return `(async () => {
	try {
		const bridge = window[${JSON.stringify(BRIDGE_GLOBAL)}] ??= (${createViewerBridge})(window);
		const args = JSON.parse(${JSON.stringify(JSON.stringify(args))});
		return { ok: true, value: await bridge[${JSON.stringify(method)}](...args) };
	} catch (e) {
		return { ok: false, error: String(e?.message ?? e) };
	}
})()
//# sourceURL=positronViewerBridge.js
`;
}

/**
 * Creates the Viewer bridge for the window of an app showing in the Viewer.
 * The bridge reads the app's page as a compact outline for agents, modeled on
 * agent-browser's and Playwright's snapshots: element roles and names, key
 * properties, and refs for the controls.
 *
 * This function MUST be self-contained. On Desktop it's serialized with
 * `Function.prototype.toString` and run in the app's frame, so it can't use
 * imports, module-level values or other functions from this file. It must also
 * use the app window's own constructors (`win.MutationObserver`), because in
 * web builds it runs in Positron's page but acts on the app's same-origin
 * frame, where `instanceof` checks against Positron's classes fail.
 *
 * @param win The app's window.
 * @returns The bridge.
 */
export function createViewerBridge(win: Window & typeof globalThis): IViewerBridge {
	const doc = win.document;
	const TEXT_NODE = 3;
	const SHOW_TEXT = 4;
	const MAX_ROWS_PER_TABLE = 50;
	const MAX_OPTIONS = 20;
	const DEFAULT_MAX_CHARS = 50_000;

	const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK']);
	// 'listbox' is deliberately absent: its options are the things to act on
	// (Dash's radio items, checklists and dropdown popups are listboxes of
	// options). A native <select> is still one control.
	const INTERACTIVE = new Set(['link', 'button', 'textbox', 'searchbox', 'spinbutton', 'checkbox', 'radio',
		'switch', 'slider', 'combobox', 'option', 'tab', 'menuitem']);
	const INTERACTIVE_SELECTOR = 'a[href],button,input:not([type="hidden"]),select,textarea,' +
		[...INTERACTIVE].map(role => `[role="${role}"]`).join(',');
	// Roles whose content is summarized by their name. Other roles are containers.
	const LEAF_ROLES = new Set([...INTERACTIVE, 'heading', 'img', 'progressbar', 'meter']);
	const TABLE_ROLES = new Set(['table', 'grid', 'treegrid']);
	const IGNORED_ROLES = new Set(['presentation', 'none', 'generic']);
	const HAS_STRUCTURE = 'a[href],button,input,select,textarea,img,svg,canvas,iframe,h1,h2,h3,h4,h5,h6,table,[role]';

	interface WalkState {
		readonly lines: string[];
		readonly interactiveOnly: boolean;
		readonly maxChars: number;
		/** Shadow hosts and their ancestors, whose content `querySelector` can't see. */
		readonly shadowHosts: Set<Element>;
		chars: number;
		truncated: boolean;
		nextRef: number;
	}

	// The widgets' own objects, which frameworks keep on the element or behind jQuery.
	interface IonRangeSliderData { result?: { from?: number; min?: number; max?: number } }
	interface JQueryLike { data(key: string): IonRangeSliderData | undefined }
	interface SelectizeLike {
		options: Record<string, Record<string, unknown>>;
		settings: { valueField: string };
		getValue(): string | string[];
	}
	interface PlotlyTraceLike { type?: string; name?: string }
	interface PlotlyPointLike { p?: unknown; s?: unknown; x?: unknown; y?: unknown; trace?: PlotlyTraceLike }
	interface PlotlyGraphLike {
		data: PlotlyTraceLike[];
		calcdata?: (PlotlyPointLike[] | undefined)[];
		// The traces with their data decoded (Plotly 6 sends arrays base64-encoded).
		_fullData?: ({ x?: ArrayLike<unknown>; y?: ArrayLike<unknown> } | undefined)[];
		layout?: { title?: string | { text?: string } };
	}

	const clean = (s: string | null | undefined, max = 100): string => {
		const text = (s || '').replace(/\s+/g, ' ').trim();
		return text.length > max ? text.slice(0, max - 3) + '...' : text;
	};
	// SVG elements have no innerText; join their text nodes with spaces so axis labels don't run together.
	const textNodesOf = (el: Element): string => {
		const walker = el.ownerDocument.createTreeWalker(el, SHOW_TEXT);
		const parts: string[] = [];
		while (walker.nextNode()) {
			parts.push(walker.currentNode.textContent || '');
		}
		return parts.join(' ');
	};
	// Canvas fallback content isn't rendered, so its innerText is empty; read textContent there.
	const textOf = (el: Element, max?: number, fallback = false): string => {
		if (fallback) {
			return clean(textNodesOf(el), max);
		}
		const inner = (el as HTMLElement).innerText;
		return clean(typeof inner === 'string' ? inner : textNodesOf(el), max);
	};
	const directTextOf = (el: Element): string => clean([...el.childNodes]
		.filter(n => n.nodeType === TEXT_NODE)
		.map(n => n.textContent)
		.join(' '), 300);
	const viewOf = (el: Element): Window & typeof globalThis => (el.ownerDocument.defaultView || win) as Window & typeof globalThis;
	const rootOf = (el: Element): Document | ShadowRoot => el.getRootNode() as Document | ShadowRoot;
	// Text inside a <label> that wraps a control is already that control's name.
	const inControlLabel = (el: Element): boolean => !!el.closest('label')?.querySelector('input,select,textarea');
	const labelForId = (el: Element, id: string | null | undefined): Element | null =>
		id ? rootOf(el).querySelector(`label[for="${win.CSS.escape(id)}"]`) : null;

	// Framework widgets whose real <input>/<select> is hidden behind custom chrome.
	const isShinySlider = (el: Element): boolean => el.tagName === 'INPUT' && el.classList.contains('js-range-slider');
	const selectizeOf = (el: Element): SelectizeLike | undefined =>
		el.tagName === 'SELECT' ? (el as unknown as { selectize?: SelectizeLike }).selectize : undefined;
	const isWidgetChrome = (el: Element): boolean => el.classList.contains('irs') ||
		el.classList.contains('selectize-control') ||
		// Streamlit's Deploy / main-menu toolbar, and the hover toolbars on charts and dataframes.
		['stHeader', 'stElementToolbar'].includes((el as HTMLElement).dataset?.testid ?? '');
	const plotlyOf = (el: Element): PlotlyGraphLike | undefined => {
		const graph = el as unknown as PlotlyGraphLike;
		return el.classList.contains('js-plotly-plot') && Array.isArray(graph.data) ? graph : undefined;
	};
	// A button that opens a listbox popup behaves like a select (Dash 4's
	// dcc.Dropdown). Not the "Open" toggle beside an editable combobox
	// (Streamlit's selectbox); that input is the control.
	const isPopupSelect = (el: Element): boolean => {
		if (el.tagName !== 'BUTTON' || el.getAttribute('aria-haspopup') !== 'listbox') {
			return false;
		}
		for (let a = el.parentElement, depth = 0; a && depth < 3; a = a.parentElement, depth++) {
			if (a.querySelector('input[role="combobox"]')) {
				return false;
			}
		}
		return true;
	};

	/**
	 * Whether an element shows on the page: `hidden` (nothing in it renders),
	 * `invisible` (visibility: hidden, so the element's own content doesn't
	 * show but a descendant can make itself visible again), or `shown`.
	 */
	function renderStateOf(el: Element, fallback: boolean): 'hidden' | 'invisible' | 'shown' {
		if ((el as HTMLElement).hidden || el.getAttribute('aria-hidden') === 'true') {
			return 'hidden';
		}
		const style = viewOf(el).getComputedStyle(el);
		if (style.display === 'none') {
			return 'hidden';
		}
		// Canvas fallback content is never rendered, so it has no layout to check.
		if (!fallback && el.getClientRects().length === 0 && style.display !== 'contents') {
			return 'hidden';
		}
		return style.visibility === 'hidden' || style.visibility === 'collapse' ? 'invisible' : 'shown';
	}

	// Adds every element under `root` (and `root` itself) that has an open
	// shadow root, plus its ancestors across shadow boundaries. Selectors don't
	// reach into shadow roots, so these are the elements whose content a
	// `querySelector` check would miss. Only `root`'s subtree is scanned, so a
	// snapshot of part of the page doesn't pay for the whole document.
	function addShadowHosts(marked: Set<Element>, root: Element): void {
		const mark = (host: Element) => {
			for (let a: Element | null = host; a && !marked.has(a); a = a.parentElement ?? (a.getRootNode() as ShadowRoot).host ?? null) {
				marked.add(a);
			}
		};
		const visit = (scope: Element | ShadowRoot) => {
			for (const el of scope.querySelectorAll('*')) {
				if (el.shadowRoot) {
					mark(el);
					visit(el.shadowRoot);
				}
			}
		};
		if (root.shadowRoot) {
			mark(root);
			visit(root.shadowRoot);
		}
		visit(root);
	}

	// The elements that render in place of `el`'s children: an open shadow
	// root's children, or the elements assigned to a slot.
	function childrenOf(el: Element): Element[] {
		if (el.shadowRoot) {
			return [...el.shadowRoot.children];
		}
		if (el.tagName === 'SLOT') {
			const assigned = (el as HTMLSlotElement).assignedElements({ flatten: true });
			return assigned.length ? assigned : [...el.children];
		}
		return [...el.children];
	}

	function roleOf(el: Element): string | null {
		const explicit = el.getAttribute('role');
		if (explicit) {
			return explicit.split(/\s+/)[0];
		}
		if (isPopupSelect(el)) {
			return 'combobox';
		}
		switch (el.tagName) {
			case 'A': return el.hasAttribute('href') ? 'link' : null;
			case 'BUTTON': return 'button';
			case 'SELECT': {
				const select = el as HTMLSelectElement;
				return select.multiple || select.size > 1 ? 'listbox' : 'combobox';
			}
			case 'TEXTAREA': return 'textbox';
			case 'IMG': return 'img';
			case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': return 'heading';
			case 'TABLE': return 'table';
			case 'NAV': return 'navigation';
			case 'MAIN': return 'main';
			case 'CANVAS': return 'canvas';
			case 'IFRAME': return 'iframe';
			case 'INPUT': {
				const type = (el.getAttribute('type') || 'text').toLowerCase();
				if (type === 'hidden') {
					return null;
				}
				if (['button', 'submit', 'reset', 'image'].includes(type)) {
					return 'button';
				}
				if (type === 'checkbox') {
					return 'checkbox';
				}
				if (type === 'radio') {
					return 'radio';
				}
				if (type === 'range') {
					return 'slider';
				}
				if (type === 'number') {
					return 'spinbutton';
				}
				if (type === 'search') {
					return 'searchbox';
				}
				return 'textbox';
			}
		}
		return null;
	}

	function labelFor(el: Element, fallback: boolean): string {
		const root = rootOf(el);
		const labelledBy = el.getAttribute('aria-labelledby');
		if (labelledBy) {
			// Per the accessible-name rules, a self-reference contributes the element's own aria-label.
			const label = clean(labelledBy.split(/\s+/).map(id => {
				const ref = root.getElementById(id);
				if (!ref) {
					return '';
				}
				return ref === el ? el.getAttribute('aria-label') || '' : textOf(ref, 200, fallback);
			}).join(' '));
			// When the ids name nothing (yet), fall through to the other sources.
			if (label) {
				return label;
			}
		}
		const aria = el.getAttribute('aria-label');
		if (aria) {
			return clean(aria);
		}
		if (el.id) {
			const label = labelForId(el, el.id) || root.getElementById(`${el.id}-label`); // Shiny's convention
			if (label) {
				return textOf(label, undefined, fallback);
			}
		}
		const wrapping = el.closest('label');
		if (wrapping) {
			return textOf(wrapping, undefined, fallback);
		}
		// Dash puts the component id (and so the <label for>) on a wrapper, not the focusable element.
		for (let a = el.parentElement, depth = 0; a && depth < 4; a = a.parentElement, depth++) {
			const label = labelForId(el, a.id);
			if (label) {
				return textOf(label, undefined, fallback);
			}
		}
		return '';
	}

	function nameOf(el: Element, role: string, fallback: boolean): string {
		// A popup select's accessible name is often its current value; the <label for> says what it is.
		const popupLabel = isPopupSelect(el) && labelForId(el, el.id);
		if (popupLabel) {
			return textOf(popupLabel, undefined, fallback);
		}
		const label = labelFor(el, fallback);
		if (label) {
			return label;
		}
		if (role === 'img') {
			return clean(el.getAttribute('alt') || el.getAttribute('title'));
		}
		if (TABLE_ROLES.has(role) && el.tagName === 'TABLE') {
			const caption = (el as HTMLTableElement).caption;
			if (caption) {
				return textOf(caption, undefined, fallback);
			}
		}
		if (['button', 'link', 'heading', 'tab', 'menuitem', 'option', 'checkbox', 'radio'].includes(role)) {
			if (el.tagName === 'INPUT') {
				return clean((el as HTMLInputElement).value || el.getAttribute('title'));
			}
			return textOf(el, undefined, fallback) ||
				clean(el.querySelector('img')?.getAttribute('alt') || el.getAttribute('title'));
		}
		return clean(el.getAttribute('placeholder') || el.getAttribute('title'));
	}

	function propsOf(el: Element, role: string, fallback: boolean): string {
		const p: string[] = [];
		const input = el as HTMLInputElement;
		const isInput = el.tagName === 'INPUT';
		if (role === 'heading') {
			p.push(`[level=${el.getAttribute('aria-level') || (/^H[1-6]$/.test(el.tagName) ? el.tagName[1] : '?')}]`);
		}
		if (['textbox', 'searchbox', 'spinbutton'].includes(role) && (isInput || el.tagName === 'TEXTAREA')) {
			p.push(`value=${JSON.stringify(clean(input.value, 80))}`);
		}
		if (role === 'slider') {
			p.push(isInput
				? `value=${input.value} min=${input.min} max=${input.max}`
				: `value=${el.getAttribute('aria-valuetext') || el.getAttribute('aria-valuenow')} min=${el.getAttribute('aria-valuemin')} max=${el.getAttribute('aria-valuemax')}`);
		}
		if (role === 'combobox' && isInput) {
			p.push(`value=${JSON.stringify(clean(input.value, 80))}`);
		}
		if (isPopupSelect(el)) {
			p.push(`value=${JSON.stringify(textOf(el, 80, fallback))}`);
		}
		// ARIA state on custom widgets (options, toggles, disclosure buttons).
		if (el.getAttribute('aria-selected') === 'true') {
			p.push('selected');
		}
		const ariaChecked = el.getAttribute('aria-checked');
		if (ariaChecked && !isInput) {
			p.push(ariaChecked === 'true' ? 'checked' : ariaChecked === 'mixed' ? 'mixed' : 'unchecked');
		}
		if (el.getAttribute('aria-pressed') === 'true') {
			p.push('pressed');
		}
		const expanded = el.getAttribute('aria-expanded');
		if (expanded && role !== 'combobox' && !isInput) {
			p.push(expanded === 'true' ? 'expanded' : 'collapsed');
		}
		if (['checkbox', 'radio', 'switch'].includes(role) && isInput) {
			p.push(input.checked ? 'checked' : 'unchecked');
		}
		if ((role === 'combobox' || role === 'listbox') && el.tagName === 'SELECT') {
			const select = el as HTMLSelectElement;
			p.push(`value=${JSON.stringify([...select.selectedOptions].map(o => o.text.trim()).join(', '))}`);
			p.push(`options=${JSON.stringify([...select.options].slice(0, MAX_OPTIONS).map(o => o.text.trim()))}`);
		}
		// :disabled also covers controls in a disabled <fieldset>.
		if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') {
			p.push('disabled');
		}
		return p.join(' ');
	}

	/** Adds a line unless it would go over the budget. */
	function push(state: WalkState, line: string): boolean {
		if (state.truncated) {
			return false;
		}
		if (state.chars + line.length + 1 > state.maxChars) {
			state.truncated = true;
			return false;
		}
		state.lines.push(line);
		state.chars += line.length + 1;
		return true;
	}

	/** Removes the last line (an empty container). */
	function pop(state: WalkState): void {
		const line = state.lines.pop();
		if (line !== undefined) {
			state.chars -= line.length + 1;
		}
	}

	/** Adds an element's line, with a ref if it's a control. Returns whether a line was added. */
	function emit(state: WalkState, indent: number, role: string, name: string, el: Element, props: string): boolean {
		const interactive = INTERACTIVE.has(role) || el.tagName === 'SELECT';
		if (state.interactiveOnly && !interactive) {
			return false;
		}
		let line = `${'  '.repeat(indent)}- ${role}`;
		if (name) {
			line += ` ${JSON.stringify(name)}`;
		}
		// Refs number the controls in order. Resolving a ref back to its element
		// comes with the actions (click, fill, ...), which aren't built yet.
		if (interactive) {
			line += ` [ref=e${state.nextRef}]`;
		}
		if (props) {
			line += ` ${props}`;
		}
		if (!push(state, line)) {
			return false;
		}
		if (interactive) {
			state.nextRef++;
		}
		return true;
	}

	function pushText(state: WalkState, indent: number, text: string): void {
		if (text && !state.interactiveOnly) {
			push(state, `${'  '.repeat(indent)}- text ${JSON.stringify(text)}`);
		}
	}

	// Plotly draws unlabeled SVG paths but keeps the plotted numbers on the
	// graph div. One line per trace: bar and histogram bins as position:size,
	// other points as x:y (the first 30).
	function emitPlotly(state: WalkState, indent: number, graph: PlotlyGraphLike): void {
		if (state.interactiveOnly) {
			return;
		}
		const num = (v: unknown) => typeof v === 'number' ? +v.toPrecision(4) : v;
		const pad = '  '.repeat(indent);
		const title = graph.layout?.title;
		if (!push(state, `${pad}- chart ${JSON.stringify(typeof title === 'string' ? title : title?.text || '')} (plotly)`)) {
			return;
		}
		(graph.calcdata || []).forEach((cd, i) => {
			const trace = cd?.[0]?.trace || graph.data[i] || {};
			// WebGL traces (scattergl) keep one placeholder point with x: false in
			// calcdata; their values are only in the trace's full data.
			const points = (cd || []).filter(d => d && (d.p !== undefined || (d.x !== undefined && d.x !== false)));
			let pairs = points.slice(0, 30).map(d => d.p !== undefined ? `${num(d.p)}:${num(d.s)}` : `${num(d.x)}:${num(d.y)}`);
			let count = points.length;
			const full = graph._fullData?.[i];
			if (!count && full?.x && typeof full.x.length === 'number') {
				const xs = full.x;
				const ys = full.y;
				count = xs.length;
				pairs = Array.from({ length: Math.min(30, count) }, (_, k) => `${num(xs[k])}:${num(ys?.[k])}`);
			}
			const list = pairs.length ? ` [${pairs.join(' ')}${count > 30 ? ' ...' : ''}]` : '';
			push(state, `${pad}  - ${trace.type || 'trace'}${trace.name ? ` ${JSON.stringify(trace.name)}` : ''} n=${count}${list}`);
		});
	}

	// The rows of a table, not counting the rows of tables nested in it.
	function rowsOf(table: Element): Element[] {
		if (table.tagName === 'TABLE') {
			return [...(table as HTMLTableElement).rows];
		}
		return [...table.querySelectorAll('[role="row"]')]
			.filter(row => row.parentElement?.closest('table,[role="table"],[role="grid"],[role="treegrid"]') === table);
	}

	function cellsOf(row: Element): Element[] {
		if (row.tagName === 'TR') {
			return [...(row as HTMLTableRowElement).cells];
		}
		return [...row.querySelectorAll('[role="cell"],[role="gridcell"],[role="columnheader"],[role="rowheader"]')]
			.filter(cell => cell.parentElement?.closest('tr,[role="row"]') === row);
	}

	// Tables are summarized one line per row, with the cells' text joined by
	// " | ". A row with controls in it is walked instead, so the controls get refs.
	function emitTable(state: WalkState, indent: number, role: string, el: Element, fallback: boolean): void {
		if (state.interactiveOnly) {
			walkChildren(state, el, indent, fallback);
			return;
		}
		if (!emit(state, indent, role, nameOf(el, role, fallback), el, '')) {
			return;
		}
		const pad = '  '.repeat(indent + 1);
		const rows = rowsOf(el);
		let listed = 0;
		for (let i = 0; i < rows.length && !state.truncated; i++) {
			const row = rows[i];
			// Checked one row at a time, so a long table costs only the rows it lists.
			if (renderStateOf(row, fallback) !== 'shown') {
				continue;
			}
			if (listed === MAX_ROWS_PER_TABLE) {
				// The rest weren't checked, and some may be hidden or empty.
				push(state, `${pad}- text "(up to ${rows.length - i} more rows)"`);
				return;
			}
			if (row.querySelector(INTERACTIVE_SELECTOR)) {
				listed++;
				walkChildren(state, row, indent + 1, fallback);
				continue;
			}
			const cells = cellsOf(row).map(cell => textOf(cell, 100, fallback));
			// Empty rows (spacers, separators) add nothing, so they don't count.
			if (cells.some(text => text)) {
				listed++;
				push(state, `${pad}- row ${JSON.stringify(cells.join(' | '))}`);
			}
		}
	}

	function walkChildren(state: WalkState, el: Element, indent: number, fallback: boolean): void {
		for (const child of childrenOf(el)) {
			if (state.truncated) {
				return;
			}
			walk(state, child, indent, fallback);
		}
	}

	/**
	 * Adds the outline of an element and its content.
	 *
	 * @param fallback Whether the element is canvas fallback content, which is
	 *   in the DOM for assistive technology but never rendered.
	 */
	function walk(state: WalkState, el: Element, indent: number, fallback: boolean): void {
		if (state.truncated || SKIP_TAGS.has(el.tagName) || isWidgetChrome(el)) {
			return;
		}

		// Framework adapters run before the hidden check: their real inputs are hidden.
		if (isShinySlider(el)) {
			const r = (viewOf(el) as unknown as { jQuery?: (el: Element) => JQueryLike }).jQuery?.(el).data('ionRangeSlider')?.result;
			const input = el as HTMLInputElement;
			emit(state, indent, 'slider', labelFor(el, fallback), el,
				`value=${r?.from ?? input.value} min=${r?.min ?? input.dataset.min} max=${r?.max ?? input.dataset.max}`);
			return;
		}
		const selectize = selectizeOf(el);
		if (selectize) {
			const options = Object.values(selectize.options).map(o => o[selectize.settings.valueField]);
			emit(state, indent, 'combobox', labelFor(el, fallback), el,
				`value=${JSON.stringify(selectize.getValue())} options=${JSON.stringify(options.slice(0, MAX_OPTIONS))}`);
			return;
		}

		const renderState = renderStateOf(el, fallback);
		if (renderState === 'hidden') {
			return;
		}
		if (renderState === 'invisible') {
			walkChildren(state, el, indent, fallback);
			return;
		}

		const plotly = plotlyOf(el);
		if (plotly) {
			emitPlotly(state, indent, plotly);
			return;
		}

		const role = roleOf(el);
		if (role && !IGNORED_ROLES.has(role)) {
			const childIndent = state.interactiveOnly ? indent : indent + 1;
			if (TABLE_ROLES.has(role)) {
				emitTable(state, indent, role, el, fallback);
				return;
			}
			const name = nameOf(el, role, fallback);
			const props = propsOf(el, role, fallback);
			const emitted = emit(state, indent, role, name, el, props);
			const linesBefore = state.lines.length;
			if (role === 'iframe') {
				let inner: HTMLElement | null | undefined;
				try {
					inner = (el as HTMLIFrameElement).contentDocument?.body;
				} catch {
					// cross-origin
				}
				if (inner) {
					// A same-origin frame is its own document, so scan it for shadow hosts too.
					addShadowHosts(state.shadowHosts, inner);
					walk(state, inner, childIndent, false);
				} else if (emitted) {
					push(state, `${'  '.repeat(childIndent)}- text "(cross-origin frame, not readable)"`);
				}
				return;
			}
			if (role === 'canvas') {
				// Canvas grids (Streamlit's st.dataframe) keep an accessible
				// copy of their content inside the <canvas>.
				walkChildren(state, el, childIndent, true);
				return;
			}
			if (LEAF_ROLES.has(role) || el.tagName === 'SELECT') {
				return;
			}
			pushText(state, childIndent, directTextOf(el));
			walkChildren(state, el, childIndent, fallback);
			// Leave out containers with nothing in them.
			if (emitted && !name && !props && state.lines.length === linesBefore && !state.truncated) {
				pop(state);
			}
			return;
		}

		// No role: plain text if nothing structural is inside, otherwise descend.
		const isLabelText = el.tagName === 'LABEL' || inControlLabel(el);
		if (!state.shadowHosts.has(el) && !el.querySelector(HAS_STRUCTURE)) {
			if (!isLabelText) {
				pushText(state, indent, textOf(el, 300, fallback));
			}
			return;
		}
		if (!isLabelText) {
			pushText(state, indent, directTextOf(el));
		}
		walkChildren(state, el, indent, fallback);
	}

	// Options can arrive as null: on Desktop the arguments cross into the app's
	// frame as JSON, where a missing argument becomes null.
	function snapshot(options?: IViewerSnapshotOptions | null): IViewerSnapshot {
		options ??= {};
		const root = options.selector ? doc.querySelector(options.selector) : doc.body || doc.documentElement;
		if (!root) {
			throw new Error(`Nothing in the Viewer matches the selector ${JSON.stringify(options.selector)}.`);
		}
		const state: WalkState = {
			lines: [],
			interactiveOnly: !!options.interactiveOnly,
			maxChars: options.maxChars && options.maxChars > 0 ? options.maxChars : DEFAULT_MAX_CHARS,
			shadowHosts: new Set(),
			chars: 0,
			truncated: false,
			nextRef: 1,
		};
		addShadowHosts(state.shadowHosts, root);
		walk(state, root, 0, false);
		let text = state.lines.join('\n');
		if (!text) {
			// Say why there's nothing: an empty page, or a first line too long for maxChars.
			text = state.truncated
				? `(nothing fits in maxChars=${state.maxChars}; ask for more)`
				: state.interactiveOnly ? '(no controls)' : '(no content)';
		}
		return {
			text,
			url: win.location.href,
			title: doc.title,
			truncated: state.truncated,
		};
	}

	// Framework "still computing" signals: the page still loading, Shiny's busy
	// class, Streamlit's Running... status widget, and Dash's default update title.
	const isBusy = (): boolean => doc.readyState === 'loading' ||
		doc.documentElement.classList.contains('shiny-busy') ||
		/Running/i.test(doc.querySelector('[data-testid="stStatusWidget"]')?.textContent || '') ||
		doc.title === 'Updating...';

	// Settled = the framework isn't busy and the DOM hasn't changed for quietMs (or timeoutMs has passed).
	function waitForIdle(options?: IViewerIdleOptions | null): Promise<IViewerIdleResult> {
		const quietMs = options?.quietMs ?? 500;
		const timeoutMs = options?.timeoutMs ?? 5000;
		return new Promise(resolve => {
			const start = Date.now();
			let lastMutation = start;
			const observer = new win.MutationObserver(() => {
				lastMutation = Date.now();
			});
			observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
			const tick = () => {
				const now = Date.now();
				const timedOut = now - start >= timeoutMs;
				if ((!isBusy() && now - lastMutation >= quietMs) || timedOut) {
					observer.disconnect();
					resolve({ waitedMs: now - start, timedOut });
				} else {
					win.setTimeout(tick, 50);
				}
			};
			win.setTimeout(tick, Math.min(100, quietMs));
		});
	}

	function viewport(): IViewerViewport {
		return { width: win.innerWidth, height: win.innerHeight };
	}

	return { snapshot, waitForIdle, viewport };
}
