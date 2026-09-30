/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The bridge reads the DOM of a third-party app in the Viewer, which Positron
// didn't build and has no element references into, so it has to use selectors.
/* eslint-disable no-restricted-syntax */

import type { IViewerActOutcome, IViewerBridge, IViewerIdleOptions, IViewerIdleResult, IViewerSnapshotOptions, IViewerViewport, ViewerAction, ViewerBridgeSnapshot } from '../common/positronViewerAgent.js';

/** Caches the bridge in the app's window on Desktop, where each call is a separate script. */
const BRIDGE_GLOBAL = '__positronViewerBridge1';

/**
 * Returns a script that runs one bridge method in the app's frame and resolves
 * to `{ ok: true, value }` or `{ ok: false, error }`. `args` must be
 * JSON-serializable. Used on Desktop, where the app's frame is cross-origin
 * and can only be reached through the main process.
 */
export function viewerBridgeScript(method: keyof IViewerBridge, args: readonly unknown[]): string {
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
 * Creates the Viewer bridge for the window of an app showing in the Viewer. It
 * reads the page as an outline for agents, modeled on agent-browser's and
 * Playwright's snapshots (roles, names, key properties, and refs for the
 * controls), and takes actions on the controls.
 *
 * This function MUST be self-contained. On Desktop it's serialized with
 * `Function.prototype.toString` and run in the app's frame, so it can't use
 * imports, module-level values or other functions from this file. It must also
 * use the app window's own constructors (`win.MutationObserver`), because in
 * web builds it runs in Positron's page but acts on the app's same-origin
 * frame, where `instanceof` checks against Positron's classes fail.
 */
export function createViewerBridge(win: Window & typeof globalThis): IViewerBridge {
	const doc = win.document;
	const ELEMENT_NODE = 1;
	const TEXT_NODE = 3;
	const SHOW_TEXT = 4;
	const MAX_ROWS_PER_TABLE = 50;
	const MAX_OPTIONS = 20;
	const DEFAULT_MAX_CHARS = 50_000;
	// The longest an action waits, well within the service's timeout for a call.
	const MAX_WAIT_MS = 15_000;
	const SLIDER_TIME_MS = 8_000;
	const COMBOBOX_LIST_MS = 1_500;

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
	}

	// A control keeps its ref for as long as it's on the page, so refs from any
	// snapshot stay good until the app re-renders the control.
	const refElements = new Map<string, WeakRef<Element>>();
	const elementRefs = new WeakMap<Element, string>();
	let nextRef = 1;

	// The widgets' own objects, which frameworks keep on the element or behind jQuery.
	interface IonRangeSliderData {
		result?: { from?: number; min?: number; max?: number };
		update?(options: { from: number }): void;
	}
	// bootstrap-datepicker's instance. Its dates are UTC midnights.
	interface DatepickerData {
		o: { startDate: unknown; endDate: unknown };
		dateWithinRange(date: Date): boolean;
		dateIsDisabled(date: Date): boolean;
	}
	interface JQueryLike {
		data(key: 'ionRangeSlider'): IonRangeSliderData | undefined;
		data(key: 'datepicker'): DatepickerData | undefined;
		trigger?(event: string): void;
		// Shiny's bootstrap-datepicker, renamed so it doesn't clash with others.
		bsDatepicker?(method: 'setUTCDate' | 'getUTCDate', date?: Date): unknown;
	}
	interface SelectizeLike {
		options: Record<string, Record<string, unknown>>;
		settings: { valueField: string; labelField?: string; maxItems?: number | null };
		getValue(): string | string[];
		setValue(value: string | string[]): void;
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
	// The text of an element as it reads, without the parts hidden from
	// assistive technology (icons, KaTeX's visual copy), which innerText keeps.
	// Inline elements run on; other elements are words of their own.
	const readableTextOf = (el: Element, fallback: boolean, own = true): string => {
		let text = '';
		for (const node of el.childNodes) {
			if (node.nodeType === TEXT_NODE) {
				text += own ? node.textContent : '';
			} else if (node.nodeType === ELEMENT_NODE) {
				const child = node as Element;
				const state = renderStateOf(child, fallback);
				if (state !== 'hidden') {
					// A visibility:hidden element's own text doesn't show, but its descendants' can.
					const inner = readableTextOf(child, fallback, state === 'shown');
					text += viewOf(child).getComputedStyle(child).display.startsWith('inline') ? inner : ` ${inner} `;
				}
			}
		}
		return text;
	};
	const directTextOf = (el: Element): string => clean([...el.childNodes]
		.filter(n => n.nodeType === TEXT_NODE)
		.map(n => n.textContent)
		.join(' '), 300);
	const viewOf = (el: Element): Window & typeof globalThis => (el.ownerDocument.defaultView || win) as Window & typeof globalThis;
	const rootOf = (el: Element): Document | ShadowRoot => el.getRootNode() as Document | ShadowRoot;
	// A <label> tied to a control names it, so its text is already in the
	// control's line. Dash's html.Label is often tied to nothing, and then its
	// text is all that says what the control below it is.
	const namesControl = (label: Element): boolean => {
		const root = rootOf(label);
		const target = label.getAttribute('for');
		return !!label.querySelector(INTERACTIVE_SELECTOR) ||
			!!(target && root.getElementById(target)) ||
			!!(label.id && root.querySelector(`[aria-labelledby~="${win.CSS.escape(label.id)}"]`));
	};
	const labelForId = (el: Element, id: string | null | undefined): Element | null =>
		id ? rootOf(el).querySelector(`label[for="${win.CSS.escape(id)}"]`) : null;

	// Framework widgets whose real <input>/<select> is hidden behind custom chrome.
	const isShinySlider = (el: Element): boolean => el.tagName === 'INPUT' && el.classList.contains('js-range-slider');
	const selectizeOf = (el: Element): SelectizeLike | undefined =>
		el.tagName === 'SELECT' ? (el as unknown as { selectize?: SelectizeLike }).selectize : undefined;
	const isShinyDateInput = (el: Element): boolean => el.tagName === 'INPUT' && !!el.closest('.shiny-date-input, .shiny-date-range-input');
	// Streamlit's multiselect shows its picks as tags, hidden from assistive
	// technology, beside its combobox.
	const tagValue = (tag: Element) => tag.getAttribute('aria-label') ?? textOf(tag);
	const multiSelectTags = (el: Element): string[] | undefined => {
		const box = el.tagName === 'INPUT' && el.getAttribute('role') === 'combobox' ? el.closest('[data-testid="stMultiSelect"]') : null;
		return box ? [...box.querySelectorAll('[data-tag]')].map(tagValue) : undefined;
	};
	// Shiny covers the page with this overlay when the app's server has gone.
	const shinyDisconnected = (): boolean => !!doc.getElementById('shiny-disconnected-overlay');
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

	// Marks the elements under `root` (and `root`) that have an open shadow
	// root, and their ancestors across shadow boundaries, since `querySelector`
	// can't see into shadow roots.
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
		// A label names the controls it wraps, not an icon beside its text.
		const wrapping = el.matches(INTERACTIVE_SELECTOR) ? el.closest('label') : null;
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
			const tags = multiSelectTags(el);
			if (tags) {
				p.push(`selected=${JSON.stringify(tags)}`);
			}
		}
		if (isPopupSelect(el)) {
			p.push(`value=${JSON.stringify(textOf(el, 80, fallback))}`);
		}
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
		const ref = interactive ? elementRefs.get(el) ?? `e${nextRef}` : undefined;
		if (ref) {
			line += ` [ref=${ref}]`;
		}
		if (props) {
			line += ` ${props}`;
		}
		if (!push(state, line)) {
			return false;
		}
		// Only controls that made it into a snapshot get a ref.
		if (ref && !elementRefs.has(el)) {
			elementRefs.set(el, ref);
			refElements.set(ref, new WeakRef(el));
			nextRef++;
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
			// Empty rows (spacers) don't count toward the cap.
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
		const label = el.closest('label');
		const isLabelText = !!label && namesControl(label);
		if (!state.shadowHosts.has(el) && !el.querySelector(HAS_STRUCTURE)) {
			if (!isLabelText) {
				const hasHiddenParts = !!el.querySelector('[aria-hidden="true"]');
				pushText(state, indent, hasHiddenParts ? clean(readableTextOf(el, fallback), 300) : textOf(el, 300, fallback));
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
	function snapshot(options?: IViewerSnapshotOptions | null): ViewerBridgeSnapshot {
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
		};
		// Forget the refs of controls that are gone for good.
		for (const [ref, element] of refElements) {
			if (!element.deref()) {
				refElements.delete(ref);
			}
		}
		addShadowHosts(state.shadowHosts, root);
		walk(state, root, 0, false);
		let text = state.lines.join('\n');
		if (!text) {
			// Say why there's nothing: an empty page, or a first line too long for maxChars.
			text = state.truncated
				? `(nothing fits in maxChars=${state.maxChars}; ask for more)`
				: state.interactiveOnly ? '(no controls)' : '(no content)';
		}
		if (shinyDisconnected()) {
			text = `(The Shiny app has disconnected from its server, so its controls do nothing. Run the app again.)\n${text}`;
		}
		return {
			text,
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

	// --- Actions -------------------------------------------------------------

	/** What an action did, before the app has settled. */
	interface ActStep {
		/** What was done, for when the result can't be checked (the page went away). */
		readonly done: string;
		/** Checks the action took, once the app has settled, and says what happened. Throws if it didn't take. */
		readonly check?: () => string;
		/** Set when the action was itself a wait, so there's no need to wait again. */
		readonly waited?: IViewerIdleResult;
	}

	const sleep = (ms: number) => new Promise<void>(resolve => win.setTimeout(resolve, ms));
	const quote = (s: string) => JSON.stringify(s);
	// When the window isn't focused (common while an agent works), the browser
	// moves focus without sending focus or blur events, so send them: frameworks
	// that track focus (Streamlit's react-aria) must agree with the page.
	const hasFocus = (el: Element) => (el.getRootNode() as Document | ShadowRoot).activeElement === el;
	function focus(el: Element): void {
		// A control stays the page's active element when Positron takes focus
		// back after an action, but it has been blurred, so focus it again.
		if (hasFocus(el) && el.ownerDocument.hasFocus()) {
			return;
		}
		(el as HTMLElement).focus?.({ preventScroll: true });
		if (!el.ownerDocument.hasFocus()) {
			const view = viewOf(el);
			el.dispatchEvent(new view.FocusEvent('focus'));
			el.dispatchEvent(new view.FocusEvent('focusin', { bubbles: true }));
		}
	}
	const scrollToCenter = (el: Element) => el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
	const waitTimeout = (ms: unknown, fallback: number) => typeof ms === 'number' && ms >= 0 ? Math.min(ms, MAX_WAIT_MS) : fallback;
	// Values match as text, or as numbers when both are numbers ("10" and "10.0").
	const sameValue = (a: string, b: string) => a === b || (a.trim() !== '' && b.trim() !== '' && Number(a) === Number(b));
	const sameValues = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
	const isComboboxInput = (el: Element) => el.tagName === 'INPUT' && el.getAttribute('role') === 'combobox';

	/** How to refer to a control in messages: its role and name, as in a snapshot. */
	function describe(el: Element): string {
		const widget = isShinySlider(el) ? 'slider' : selectizeOf(el) ? 'combobox' : undefined;
		const role = widget ?? roleOf(el) ?? el.tagName.toLowerCase();
		const name = widget ? labelFor(el, false) : nameOf(el, role, false);
		return name ? `${role} ${quote(name)}` : role;
	}

	/** Finds the control for a ref from a snapshot. */
	function resolve(ref: unknown): Element {
		if (typeof ref !== 'string' || !ref) {
			throw new Error('This action needs the ref of a control from a snapshot, such as "e3".');
		}
		const el = refElements.get(ref)?.deref();
		if (!el) {
			throw new Error(`There's no control ${ref} on this page. Take a new snapshot and use a ref from it.`);
		}
		if (!el.isConnected) {
			throw new Error(`The control ${ref} is gone from the page, probably because the app redrew it. Take a new snapshot and use a ref from it.`);
		}
		return el;
	}

	/** Throws if a control can't be used right now. Framework widgets hide their real inputs, so skip those. */
	function checkUsable(el: Element, what: string): void {
		if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') {
			throw new Error(`The ${what} is disabled.`);
		}
		if (!isShinySlider(el) && !selectizeOf(el) && typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) {
			throw new Error(`The ${what} is hidden right now. Take a new snapshot to see what's showing.`);
		}
	}

	// Pointer and mouse events in the order a real pointer sends them.
	const HOVER_EVENTS = ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'];
	// Returns whether the page let the last event's default action happen.
	function sendPointer(el: Element, types: readonly string[]): boolean {
		const view = viewOf(el);
		const rect = el.getBoundingClientRect();
		const init: MouseEventInit = {
			bubbles: true, cancelable: true, composed: true, view,
			clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
		};
		let allowed = true;
		for (const type of types) {
			const Ctor = type.startsWith('pointer') ? view.PointerEvent : view.MouseEvent;
			allowed = el.dispatchEvent(new Ctor(type, type.endsWith('enter') ? { ...init, bubbles: false } : init));
		}
		return allowed;
	}

	function pressKey(el: Element, key: string): void {
		const view = viewOf(el);
		const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : key;
		for (const type of ['keydown', 'keyup']) {
			el.dispatchEvent(new view.KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, composed: true }));
		}
	}

	// Sets a value with the native setter from the element's own prototype, so
	// React's value tracking sees the change (Streamlit, Dash).
	function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
		const view = viewOf(el);
		const proto = el.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
		el.dispatchEvent(new view.Event('input', { bubbles: true }));
	}

	function leave(el: Element): void {
		if (!el.ownerDocument.hasFocus() || !hasFocus(el)) {
			const view = viewOf(el);
			el.dispatchEvent(new view.FocusEvent('blur'));
			el.dispatchEvent(new view.FocusEvent('focusout', { bubbles: true }));
		}
		(el as HTMLElement).blur?.();
	}

	// Frameworks that apply text when it's committed (Streamlit, Dash's
	// debounce) listen for change or focusout. Deliberately not Enter: inside a
	// Streamlit form, Enter submits the whole form.
	function commit(el: Element): void {
		el.dispatchEvent(new (viewOf(el).Event)('change', { bubbles: true }));
		leave(el);
	}

	/** What Shiny's server last received for an input, when the page is a Shiny app. */
	function shinyValue(el: Element): unknown {
		const values = (viewOf(el) as unknown as { Shiny?: { shinyapp?: { $inputValues?: Record<string, unknown> } } })
			.Shiny?.shinyapp?.$inputValues;
		if (!values || !el.id) {
			return undefined;
		}
		// Keys can carry a type, as in "go:shiny.action".
		const key = Object.keys(values).find(k => k === el.id || k.startsWith(`${el.id}:`));
		return key === undefined ? undefined : values[key];
	}

	/** Throws if a Shiny app's server didn't receive what the page shows. */
	function checkShiny(el: Element, expected: string | readonly string[], what: string): void {
		// A date slider sends timestamps, whatever the page shows; setShinyDate
		// checks dateInput itself.
		if (el.closest('.shiny-date-input, .shiny-date-range-input') || /^date/.test((el as HTMLElement).dataset?.dataType ?? '')) {
			return;
		}
		const server = shinyValue(el);
		if (server === undefined || server === null) {
			return;
		}
		let received = Array.isArray(server) ? server.map(String) : [String(server)];
		const shown = typeof expected === 'string' ? [expected] : expected;
		// A two-handle slider sends [from, to]; an agent sets from.
		if (isShinySlider(el) && shown.length === 1 && received.length === 2) {
			received = received.slice(0, 1);
		}
		if (!sameValues(received, shown)) {
			throw new Error(`The ${what} shows ${quote(shown.join(', '))} on the page, but the Shiny app received ${quote(received.join(', '))}.`);
		}
	}

	function noOption(what: string, wanted: string, options: readonly string[], listLabel = 'its options'): Error {
		const listed = options.slice(0, MAX_OPTIONS).map(quote).join(', ') + (options.length > MAX_OPTIONS ? ', ...' : '');
		return new Error(`The ${what} has no option ${quote(wanted)}${options.length ? ` (${listLabel}: ${listed})` : ''}.`);
	}

	function oneValueOnly(what: string, count: number): Error {
		return new Error(`The ${what} takes one value, not ${count}.`);
	}

	function toNumber(value: string, what: string): number {
		const n = Number(value);
		if (value.trim() === '' || !Number.isFinite(n)) {
			throw new Error(`The ${what} takes a number, not ${quote(value)}.`);
		}
		return n;
	}

	function click(el: Element): ActStep {
		const what = describe(el);
		checkUsable(el, what);
		scrollToCenter(el);
		// A checkbox's or switch's state, to check that the click toggled it.
		const role = roleOf(el);
		const checkedState = () => role !== 'checkbox' && role !== 'switch' ? undefined :
			el.tagName === 'INPUT' ? (el as HTMLInputElement).checked : el.getAttribute('aria-checked') === 'true';
		const before = checkedState();
		// Pressing moves focus, unless the page stops it (react-aria's options
		// do, to keep focus in their combobox).
		if (sendPointer(el, [...HOVER_EVENTS, 'pointerdown', 'mousedown'])) {
			focus(el);
		}
		sendPointer(el, ['pointerup', 'mouseup']);
		if (typeof (el as HTMLElement).click === 'function') {
			(el as HTMLElement).click();
		} else {
			sendPointer(el, ['click']); // SVG elements
		}
		return {
			done: `Clicked the ${what}.`,
			check: () => {
				const after = checkedState();
				if (after === undefined || !el.isConnected) {
					return `Clicked the ${what}.`;
				}
				if (after === before) {
					throw new Error(`Clicked the ${what}, but it's still ${after ? 'checked' : 'unchecked'}.`);
				}
				return `Clicked the ${what}; it's now ${after ? 'checked' : 'unchecked'}.`;
			},
		};
	}

	function hover(el: Element): ActStep {
		const what = describe(el);
		checkUsable(el, what);
		scrollToCenter(el);
		sendPointer(el, HOVER_EVENTS);
		return { done: `Hovered over the ${what}.` };
	}

	async function fill(el: Element, value: unknown): Promise<ActStep> {
		if (typeof value !== 'string') {
			throw new Error('fill needs a value, as a string.');
		}
		// An agent may well fill a dropdown; that's picking an option.
		if (selectizeOf(el) || el.tagName === 'SELECT' || isPopupSelect(el) || multiSelectTags(el)) {
			return select(el, value);
		}
		const what = describe(el);
		checkUsable(el, what);
		if (isShinyDateInput(el)) {
			return setShinyDate(el as HTMLInputElement, value, what);
		}
		// A combobox can be a list to pick from or a text box with suggestions:
		// pick the option with this text if there is one, or else keep the text.
		if (isComboboxInput(el)) {
			return selectInCombobox(el as HTMLInputElement, value, what, true);
		}
		if (isShinySlider(el)) {
			return setShinySlider(el as HTMLInputElement, value, what);
		}
		const role = roleOf(el);
		if (role === 'slider') {
			return setSlider(el, value, what);
		}
		const isText = role === 'textbox' || role === 'searchbox';
		if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (isText || role === 'spinbutton'))) {
			const input = el as HTMLInputElement;
			if (input.readOnly) {
				throw new Error(`The ${what} is read-only.`);
			}
			scrollToCenter(input);
			focus(input);
			setNativeValue(input, value);
			commit(input);
			return {
				done: `Filled the ${what} with ${quote(value)}.`,
				check: () => {
					if (!(role === 'spinbutton' ? sameValue(input.value, value) : input.value === value)) {
						throw new Error(`Filled the ${what}, but it shows ${quote(input.value)}, not ${quote(value)}.`);
					}
					checkShiny(input, input.value, what);
					return `Filled the ${what} with ${quote(value)}.`;
				},
			};
		}
		throw new Error(`Can't fill the ${what}. fill works on text boxes, number boxes, sliders and dropdowns.`);
	}

	/** Says where a slider ended up. Throws if it didn't move. */
	function sliderResult(el: Element, what: string, before: number, target: number, final: number): string {
		if (final !== target && final === before) {
			throw new Error(`The ${what} stays at ${final}; it can't be set to ${target}.`);
		}
		checkShiny(el, String(final), what);
		return final === target ? `Set the ${what} to ${final}.` : `Set the ${what} to ${final}, the closest it goes to ${target}.`;
	}

	// Shiny's dateInput and dateRangeInput (bootstrap-datepicker) read the date
	// from the widget, which ignores text set on the input; go through the widget.
	function setShinyDate(el: HTMLInputElement, value: string, what: string): ActStep {
		const target = value.trim();
		const parts = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/.exec(target)?.groups;
		// The widget only takes a Date from its own window.
		const date = parts && new (viewOf(el).Date)(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
		if (!date || date.toISOString().slice(0, 10) !== target) {
			throw new Error(`The ${what} takes a date as YYYY-MM-DD, such as 2026-02-03, not ${quote(value)}.`);
		}
		const widget = (viewOf(el) as unknown as { jQuery?: (el: Element) => JQueryLike }).jQuery?.(el);
		const picker = widget?.data('datepicker');
		if (!widget?.bsDatepicker || !picker) {
			throw new Error(`The ${what} isn't ready yet. Try again in a moment.`);
		}
		const isoOf = (d: unknown) => d instanceof viewOf(el).Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : undefined;
		// The widget's own range, which updateDateInput changes without the
		// input's data-min-date. Out of range, it would clear the input and send no date.
		if (!picker.dateWithinRange(date)) {
			const min = isoOf(picker.o.startDate), max = isoOf(picker.o.endDate);
			const range = min && max ? `from ${min} to ${max}` : min ? `from ${min} on` : `up to ${max}`;
			throw new Error(`The ${what} takes dates ${range}, not ${target}.`);
		}
		// The widget takes dates the app disabled, which a user can't pick.
		if (picker.dateIsDisabled(date)) {
			throw new Error(`The ${what} doesn't take ${target}: the app has disabled that date.`);
		}
		widget.bsDatepicker('setUTCDate', date);
		const container = el.closest('.shiny-date-input, .shiny-date-range-input')!;
		return {
			done: `Set the ${what} to ${target}.`,
			check: () => {
				if (isoOf(widget.bsDatepicker!('getUTCDate')) !== target) {
					throw new Error(`Set the ${what} to ${target}, but it shows ${quote(el.value)}.`);
				}
				// A dateRangeInput sends [start, end].
				const server = shinyValue(container);
				const received = Array.isArray(server) ? server[[...container.querySelectorAll('input')].indexOf(el)] : server;
				if (received !== undefined && received !== null && String(received) !== target) {
					throw new Error(`The ${what} shows ${target} on the page, but the Shiny app received ${quote(String(received))}.`);
				}
				return `Set the ${what} to ${target}.`;
			},
		};
	}

	// Shiny's sliderInput (ion.rangeSlider) hides its real input; go through the widget.
	function setShinySlider(el: HTMLInputElement, value: string, what: string): ActStep {
		const target = toNumber(value, what);
		const jQuery = (viewOf(el) as unknown as { jQuery?: (el: Element) => JQueryLike }).jQuery;
		const slider = jQuery?.(el).data('ionRangeSlider');
		if (!jQuery || !slider?.update || !slider.result) {
			throw new Error(`The ${what} isn't ready yet. Try again in a moment.`);
		}
		const result = slider.result;
		const before = Number(result.from);
		slider.update({ from: target });
		jQuery(el).trigger?.('change');
		return {
			done: `Set the ${what} to ${target}.`,
			check: () => sliderResult(el, what, before, target, Number(result.from)),
		};
	}

	// Sliders are moved with their own keyboard handling, which tells the server
	// (react-aria's in Streamlit, around a hidden range input; Radix's in Dash).
	// Setting the value moves the slider on the page without telling the server,
	// so only a plain range input, which ignores synthetic keys, gets it set.
	async function setSlider(el: Element, value: string, what: string): Promise<ActStep> {
		const target = toNumber(value, what);
		const input = el.tagName === 'INPUT' ? el as HTMLInputElement : undefined;
		const read = () => {
			if (input) {
				return Number(input.value);
			}
			// Some sliders only give their value as text, such as "20 minutes".
			const now = el.getAttribute('aria-valuenow');
			return now !== null ? Number(now) : parseFloat(el.getAttribute('aria-valuetext') ?? '');
		};
		const before = read();
		if (Number.isNaN(before)) {
			throw new Error(`The ${what} doesn't say what its value is, so it can't be set.`);
		}
		scrollToCenter(el);
		focus(el);
		// Presses a key and waits for the widget to show its new value.
		const step = async (key: string): Promise<number> => {
			const from = read();
			pressKey(el, key);
			for (let waited = 0; waited < 300 && read() === from; waited += 20) {
				await sleep(20);
			}
			return read();
		};
		// Page keys cover the distance quickly; arrow keys finish the job.
		const deadline = Date.now() + SLIDER_TIME_MS;
		let current = before;
		let usePageKeys = true;
		// In a right-to-left slider the left and right arrows swap roles.
		let increase = 'ArrowRight';
		let decrease = 'ArrowLeft';
		let swapped = false;
		while (current !== target && el.isConnected) {
			if (Date.now() > deadline) {
				throw new Error(`Gave up moving the ${what}: it's at ${current}, not ${target}.`);
			}
			const up = target > current;
			if (usePageKeys) {
				const next = await step(up ? 'PageUp' : 'PageDown');
				// No page keys, keys that go the other way, or a jump past the
				// target: go on with arrow keys.
				if (next === current || next > current !== up || (up ? next > target : next < target)) {
					usePageKeys = false;
				}
				current = next;
				continue;
			}
			const next = await step(up ? increase : decrease);
			if (next === current) {
				break; // the end of its range
			}
			if (next > current !== up) {
				if (swapped) {
					throw new Error(`Gave up moving the ${what}: its arrow keys don't move it toward ${target}.`);
				}
				[increase, decrease] = [decrease, increase];
				swapped = true;
				current = next;
				continue;
			}
			current = next;
			if (up ? current > target : current < target) {
				break; // its steps don't land on the target
			}
		}
		if (input && current === before && target !== before) {
			setNativeValue(input, String(target));
			commit(input);
		}
		return {
			done: `Set the ${what} to ${target}.`,
			check: () => sliderResult(el, what, before, target, read()),
		};
	}

	async function select(el: Element, value: unknown): Promise<ActStep> {
		const wanted = typeof value === 'string' ? [value] :
			Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string') ? value as string[] : undefined;
		if (!wanted) {
			throw new Error('select needs a value: the text or value of an option, or a list of them.');
		}
		const what = describe(el);
		checkUsable(el, what);
		const selectize = selectizeOf(el);
		if (selectize) {
			return selectInSelectize(el, selectize, wanted, what);
		}
		if (el.tagName === 'SELECT') {
			return selectInSelect(el as HTMLSelectElement, wanted, what);
		}
		if (multiSelectTags(el)) {
			return selectInMultiSelect(el as HTMLInputElement, wanted, what);
		}
		if (wanted.length > 1) {
			throw oneValueOnly(what, wanted.length);
		}
		if (isComboboxInput(el)) {
			return selectInCombobox(el as HTMLInputElement, wanted[0], what, false);
		}
		if (isPopupSelect(el)) {
			return selectInPopup(el, wanted[0], what);
		}
		// Lists of options (Dash's radio items and checklists) have no ref of their own; their options do.
		throw new Error(`Can't select in the ${what}. select works on dropdowns; to pick an option in a list, click the option.`);
	}

	const picked = (wanted: readonly string[], what: string) => `Picked ${quote(wanted.join(', '))} in the ${what}.`;
	const notPicked = (wanted: readonly string[], what: string, shown: string) =>
		new Error(`Picked ${quote(wanted.join(', '))} in the ${what}, but it shows ${quote(shown)}.`);

	// Shiny's selectInput (selectize) hides its real <select>; go through the widget.
	function selectInSelectize(el: Element, selectize: SelectizeLike, wanted: readonly string[], what: string): ActStep {
		const { valueField, labelField = 'label', maxItems } = selectize.settings;
		const options = Object.values(selectize.options);
		const values = wanted.map(w => {
			const option = options.find(o => String(o[valueField]) === w) ?? options.find(o => String(o[labelField]) === w);
			if (!option) {
				throw noOption(what, w, options.map(o => String(o[labelField] ?? o[valueField])));
			}
			return String(option[valueField]);
		});
		const single = maxItems === 1;
		if (single && values.length > 1) {
			throw oneValueOnly(what, values.length);
		}
		selectize.setValue(single ? values[0] : values);
		return {
			done: picked(wanted, what),
			check: () => {
				const current = selectize.getValue();
				const shown = (Array.isArray(current) ? current : [current]).filter(v => v !== '');
				if (!sameValues(shown, values)) {
					throw notPicked(wanted, what, shown.join(', '));
				}
				checkShiny(el, single ? values[0] : values, what);
				return picked(wanted, what);
			},
		};
	}

	function selectInSelect(el: HTMLSelectElement, wanted: readonly string[], what: string): ActStep {
		if (!el.multiple && wanted.length > 1) {
			throw oneValueOnly(what, wanted.length);
		}
		const options = [...el.options];
		const chosen = wanted.map(w => {
			const option = options.find(o => o.value === w) ?? options.find(o => o.text.trim() === w);
			if (!option) {
				throw noOption(what, w, options.map(o => o.text.trim()));
			}
			return option;
		});
		for (const option of options) {
			option.selected = chosen.includes(option);
		}
		const view = viewOf(el);
		el.dispatchEvent(new view.Event('input', { bubbles: true }));
		el.dispatchEvent(new view.Event('change', { bubbles: true }));
		const values = chosen.map(o => o.value);
		return {
			done: picked(wanted, what),
			check: () => {
				const shown = options.filter(o => o.selected);
				if (!sameValues(shown.map(o => o.value), values)) {
					throw notPicked(wanted, what, shown.map(o => o.text.trim()).join(', '));
				}
				checkShiny(el, el.multiple ? values : values[0], what);
				return picked(wanted, what);
			},
		};
	}

	/**
	 * The options a combobox is showing: those in the list it controls, or
	 * else the ones that weren't on the page before it was typed into.
	 */
	function comboboxOptions(el: Element, before: ReadonlySet<Element>): Element[] {
		const listId = (el.getAttribute('aria-controls') || el.getAttribute('aria-owns') || '').split(/\s+/)[0];
		const list = listId ? rootOf(el).getElementById(listId) : null;
		const options = list ? [...list.querySelectorAll('[role="option"]')] :
			[...doc.querySelectorAll('[role="option"]')].filter(o => !before.has(o));
		return options.filter(o => renderStateOf(o, false) === 'shown');
	}

	/** Types into a combobox and waits for its list to show an option with exactly that text. */
	async function typeInCombobox(el: HTMLInputElement, wanted: string): Promise<{ options: Element[]; match?: Element; opened: boolean }> {
		const before = new Set(doc.querySelectorAll('[role="option"]'));
		scrollToCenter(el);
		focus(el);
		setNativeValue(el, wanted);
		// The list can take a moment to show (about 330 ms for Streamlit's when
		// it reopens), and some only open for Down (Streamlit's, on first use).
		let options: Element[] = [];
		let match: Element | undefined;
		let opened = false;
		for (const start = Date.now(); !match && Date.now() - start < COMBOBOX_LIST_MS;) {
			await sleep(100);
			options = comboboxOptions(el, before);
			match = options.find(o => textOf(o) === wanted);
			if (!match && !options.length && !opened && Date.now() - start >= 400) {
				pressKey(el, 'ArrowDown');
				opened = true;
			}
		}
		return { options, match, opened };
	}

	// ARIA comboboxes (Streamlit's selectbox): type to filter the list, then
	// click the option with exactly that text (the keyboard would take the first
	// match, which can be another option containing the text). With freeText (a
	// fill), text that matches no option is kept, as in a search box.
	async function selectInCombobox(el: HTMLInputElement, wanted: string, what: string, freeText: boolean): Promise<ActStep> {
		const { options, match, opened } = await typeInCombobox(el, wanted);
		if (match) {
			click(match);
		} else if (freeText) {
			commit(el);
			return {
				done: `Filled the ${what} with ${quote(wanted)}.`,
				check: () => {
					if (el.value !== wanted) {
						throw new Error(`Filled the ${what}, but it shows ${quote(el.value)}, not ${quote(wanted)}.`);
					}
					return `Filled the ${what} with ${quote(wanted)}.`;
				},
			};
		} else if (options.length) {
			pressKey(el, 'Escape');
			leave(el);
			throw noOption(what, wanted, options.map(o => textOf(o)), 'options with that text');
		} else {
			// No list to read: take the first match with the keyboard, and check it below.
			if (!opened) {
				pressKey(el, 'ArrowDown');
				await sleep(150);
			}
			pressKey(el, 'Enter');
			// Leaving puts back the real choice if nothing matched the typed text.
			leave(el);
		}
		return {
			done: picked([wanted], what),
			check: () => {
				// Streamlit 1.5x leaves the input empty and names the choice in its label.
				if (el.value !== wanted && !labelFor(el, false).includes(`Selected ${wanted}.`)) {
					throw notPicked([wanted], what, el.value);
				}
				return picked([wanted], what);
			},
		};
	}

	// Streamlit's multiselect: the values given become the picks. Remove the
	// others with their tags' buttons first, since at max_selections the list
	// offers nothing more, then pick each missing value from the list.
	async function selectInMultiSelect(el: HTMLInputElement, wanted: readonly string[], what: string): Promise<ActStep> {
		const picks = () => multiSelectTags(el) ?? [];
		const box = el.closest('[data-testid="stMultiSelect"]')!;
		const remove = async (value: string) => {
			const button = [...box.querySelectorAll('[data-tag]')].find(tag => tagValue(tag) === value)?.querySelector('button');
			if (!button) {
				throw new Error(`Can't remove ${quote(value)} from the ${what}.`);
			}
			click(button);
			await sleep(150);
		};
		// Picks a value from the list, or returns the list's options if it isn't one.
		const add = async (value: string): Promise<Element[] | undefined> => {
			const { options, match } = await typeInCombobox(el, value);
			if (!match) {
				pressKey(el, 'Escape');
				setNativeValue(el, '');
				return options;
			}
			click(match);
			await sleep(150);
			return undefined;
		};
		const removed = picks().filter(v => !wanted.includes(v));
		for (const extra of removed) {
			await remove(extra);
		}
		const added: string[] = [];
		for (const value of wanted.filter(v => !picks().includes(v))) {
			const options = await add(value);
			if (options) {
				// Leave the picks as they were.
				for (const v of added) {
					await remove(v);
				}
				for (const v of removed) {
					await add(v);
				}
				pressKey(el, 'Escape');
				// Streamlit also lists "No results" and "Select 2 matches" as
				// options, and at max_selections only a note saying so.
				const real = options.filter(o => o.hasAttribute('aria-selected') && !o.getAttribute('data-key')?.startsWith('__'));
				const note = real.length ? undefined : options.map(o => textOf(o)).find(text => text && text !== 'No results');
				throw note ? new Error(`The ${what} can't take ${quote(value)}: ${quote(note)}`) :
					noOption(what, value, real.map(o => textOf(o)), 'options with that text');
			}
			added.push(value);
		}
		pressKey(el, 'Escape');
		return {
			done: picked(wanted, what),
			check: () => {
				const shown = picks();
				if (shown.length !== wanted.length || !wanted.every(v => shown.includes(v))) {
					throw notPicked(wanted, what, shown.join(', '));
				}
				return picked(wanted, what);
			},
		};
	}

	// Buttons that open a listbox popup (Dash's dcc.Dropdown): open it, then
	// click the option. The popup's options are the ones that weren't on the
	// page before it opened.
	async function selectInPopup(el: Element, wanted: string, what: string): Promise<ActStep> {
		const before = new Set(doc.querySelectorAll('[role="option"]'));
		const newOptions = () => [...doc.querySelectorAll('[role="option"]')]
			.filter(o => !before.has(o) && renderStateOf(o, false) === 'shown');
		click(el);
		await sleep(300);
		let options = newOptions();
		let match = options.find(o => textOf(o) === wanted);
		// Searching filters the list, so name the options from before it.
		const seen = options.map(o => textOf(o));
		if (!match) {
			// Long or virtualized lists: type into the popup's search box to bring the option into view.
			const search = options[0]?.closest('[role="dialog"], [data-state="open"]')
				?.querySelector<HTMLInputElement>('input[type="search"], input[type="text"]');
			if (search) {
				focus(search);
				setNativeValue(search, wanted);
				await sleep(300);
				options = newOptions();
				match = options.find(o => textOf(o) === wanted);
			}
		}
		if (!match) {
			pressKey(el, 'Escape');
			throw noOption(what, wanted, seen);
		}
		click(match);
		return {
			done: picked([wanted], what),
			check: () => {
				if (!textOf(el).includes(wanted)) {
					throw notPicked([wanted], what, textOf(el));
				}
				return picked([wanted], what);
			},
		};
	}

	function press(key: unknown, ref: unknown): ActStep {
		if (typeof key !== 'string' || !key) {
			throw new Error('press needs a key, such as "Enter", "Escape" or "ArrowDown".');
		}
		const el = ref === undefined || ref === null ? undefined : resolve(ref);
		if (el) {
			checkUsable(el, describe(el));
			focus(el);
		}
		pressKey(el ?? doc.activeElement ?? doc.body ?? doc.documentElement, key);
		return { done: `Pressed ${key}${el ? ` in the ${describe(el)}` : ''}.` };
	}

	const canScroll = (el: Element): boolean => {
		const style = viewOf(el).getComputedStyle(el);
		const scrolls = (overflow: string) => overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
		return (scrolls(style.overflowY) && el.scrollHeight > el.clientHeight + 1) ||
			(scrolls(style.overflowX) && el.scrollWidth > el.clientWidth + 1);
	};

	/** The scrolling area to scroll: the control's nearest one, or the page's. */
	function scrollerFor(el: Element | undefined): Element {
		for (let a = el?.parentElement; a; a = a.parentElement) {
			if (canScroll(a)) {
				return a;
			}
		}
		const page = doc.scrollingElement ?? doc.documentElement;
		// A control with no scrolling area of its own scrolls with the page.
		if (el || page.scrollHeight > page.clientHeight + 1 || page.scrollWidth > page.clientWidth + 1) {
			return page;
		}
		// Streamlit scrolls an inner element, not the page; take the biggest area that scrolls.
		let best: Element | undefined;
		for (const candidate of doc.body?.querySelectorAll('*') ?? []) {
			if (canScroll(candidate) && (!best || candidate.clientWidth * candidate.clientHeight > best.clientWidth * best.clientHeight)) {
				best = candidate;
			}
		}
		return best ?? page;
	}

	function scroll(ref: unknown, dx: unknown, dy: unknown): ActStep {
		const el = ref === undefined || ref === null ? undefined : resolve(ref);
		const x = typeof dx === 'number' ? dx : 0;
		const y = typeof dy === 'number' ? dy : 0;
		if (el && !x && !y) {
			const what = describe(el);
			scrollToCenter(el);
			return { done: `Scrolled the ${what} into view.` };
		}
		const scroller = scrollerFor(el);
		const area = scroller === (doc.scrollingElement ?? doc.documentElement) ? 'the page' : 'the scrolling area';
		const before = { left: scroller.scrollLeft, top: scroller.scrollTop };
		scroller.scrollLeft += x;
		// With no distance, scroll down most of a screenful.
		scroller.scrollTop += x || y ? y : Math.round(scroller.clientHeight * 0.8);
		const position = () => `it's now ${Math.round(scroller.scrollTop)} px down, of ${Math.max(0, scroller.scrollHeight - scroller.clientHeight)}` +
			(scroller.scrollWidth > scroller.clientWidth ? `, and ${Math.round(scroller.scrollLeft)} px across, of ${scroller.scrollWidth - scroller.clientWidth}` : '');
		return {
			done: `Scrolled ${area}.`,
			check: () => scroller.scrollLeft === before.left && scroller.scrollTop === before.top ?
				`Nothing moved: ${area} can't scroll any further that way (${position()}).` :
				`Scrolled ${area}; ${position()}.`,
		};
	}

	async function wait(kind: unknown, text: unknown, timeoutMs: unknown): Promise<ActStep> {
		if (kind === 'idle') {
			const waited = await waitForIdle({ timeoutMs: waitTimeout(timeoutMs, 5000) });
			const done = waited.timedOut ? `The app was still busy after ${waited.waitedMs} ms.` : `The app settled after ${waited.waitedMs} ms.`;
			return { done, waited };
		}
		if (kind === 'text') {
			if (typeof text !== 'string' || !text) {
				throw new Error('Waiting for text needs the text to wait for.');
			}
			const limit = waitTimeout(timeoutMs, 10_000);
			const start = Date.now();
			const inPageText = () => ((doc.body as HTMLElement | null)?.innerText ?? '').includes(text);
			// The snapshot also reads shadow roots, same-origin frames and canvas
			// fallback content, which innerText leaves out. It costs more, so
			// check it less often.
			const inSnapshot = () => snapshot({ maxChars: Number.MAX_SAFE_INTEGER }).text.includes(quote(text).slice(1, -1));
			for (let tick = 0; !inPageText() && !(tick % 5 === 0 && inSnapshot()); tick++) {
				if (Date.now() - start >= limit) {
					throw new Error(`The text ${quote(text)} didn't show up on the page within ${limit} ms.`);
				}
				await sleep(100);
			}
			return { done: `The text ${quote(text)} is on the page (after ${Date.now() - start} ms).` };
		}
		throw new Error('A wait needs "for": "idle" or "text".');
	}

	function perform(action: ViewerAction): ActStep | Promise<ActStep> {
		switch (action.kind) {
			case 'click': return click(resolve(action.ref));
			case 'hover': return hover(resolve(action.ref));
			case 'fill': return fill(resolve(action.ref), action.value);
			case 'select': return select(resolve(action.ref), action.value);
			case 'press': return press(action.key, action.ref);
			case 'scroll': return scroll(action.ref, action.dx, action.dy);
			case 'wait': return wait(action.for, action.text, action.timeoutMs);
			// Actions arrive from extensions, so the kind can be anything.
			default: throw new Error(`Unknown action ${quote(String((action as { kind?: unknown }).kind))}. Use click, hover, fill, select, press, scroll or wait.`);
		}
	}

	// Like snapshot()'s options, the arguments can arrive as null on Desktop.
	async function act(action: ViewerAction | null, idle?: IViewerIdleOptions | null): Promise<IViewerActOutcome> {
		if (!action || typeof action !== 'object') {
			throw new Error('An action needs a kind: click, hover, fill, select, press, scroll or wait.');
		}
		if (shinyDisconnected() && action.kind !== 'wait' && action.kind !== 'scroll') {
			throw new Error('The Shiny app in the Viewer has disconnected from its server, so the action would do nothing. Run the app again, then take a new snapshot.');
		}
		// A link or a form can take the page to another document. Report that
		// rather than wait on a page that's going away.
		let navigated = false;
		let onPageHide = () => { };
		const pageHidden = new Promise<undefined>(resolve => {
			onPageHide = () => {
				navigated = true;
				resolve(undefined);
			};
		});
		win.addEventListener('pagehide', onPageHide);
		try {
			const step = await perform(action);
			const settled = step.waited ?? await Promise.race([waitForIdle(idle), pageHidden]);
			if (navigated) {
				return { message: `${step.done} The page went to another address.`, navigated, timedOut: false };
			}
			return { message: step.check?.() ?? step.done, navigated, timedOut: settled?.timedOut ?? false };
		} finally {
			win.removeEventListener('pagehide', onPageHide);
		}
	}

	return { snapshot, waitForIdle, viewport, act };
}
