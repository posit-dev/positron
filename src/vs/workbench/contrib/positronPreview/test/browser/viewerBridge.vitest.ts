/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { mainWindow } from '../../../../../base/browser/window.js';
import { createViewerBridge, viewerBridgeScript } from '../../browser/viewerBridge.js';
import { IViewerBridge, IViewerSnapshotOptions, ViewerAction } from '../../common/positronViewerAgent.js';

type AppWindow = Window & typeof globalThis;

// The markup Shiny generates for the prototype's test app (sidebarLayout with a
// slider, text input, selectize dropdown and button), trimmed to what matters.
const SHINY_APP = `
	<div class="container-fluid">
		<h2>Viewer spike</h2>
		<div class="row">
			<div class="col-sm-4">
				<form class="well" role="complementary">
					<div class="form-group shiny-input-container">
						<label class="control-label" id="bins-label" for="bins">Number of bins:</label>
						<span class="irs irs--shiny"><span class="irs-handle">30</span></span>
						<input class="js-range-slider" id="bins" data-min="1" data-max="50" value="30" style="display: none">
					</div>
					<div class="form-group shiny-input-container">
						<label class="control-label" id="label-label" for="label">Plot title:</label>
						<input id="label" type="text" class="shiny-input-text form-control" value="Old Faithful">
					</div>
					<div class="form-group shiny-input-container">
						<label class="control-label" id="color-label" for="color">Bar color:</label>
						<select id="color" style="display: none"><option value="steelblue" selected>steelblue</option></select>
						<div class="selectize-control single"><div class="selectize-input">steelblue</div></div>
					</div>
					<button class="btn btn-default action-button" id="go" type="button">Count clicks</button>
				</form>
			</div>
			<div class="col-sm-8" role="main">
				<div class="shiny-plot-output"><img src="data:image/png;base64," alt="Plot object"></div>
				<div id="clicks" class="shiny-text-output">Button clicked 0 times</div>
				<div role="log" aria-live="polite"></div>
			</div>
		</div>
	</div>`;

describe('createViewerBridge', () => {
	let frame: HTMLIFrameElement;

	beforeEach(() => {
		// The app lives in its own frame, as in the Viewer, so the bridge runs
		// in this realm but reads another one.
		frame = mainWindow.document.createElement('iframe');
		mainWindow.document.body.appendChild(frame);
	});

	afterEach(() => {
		frame.remove();
	});

	function loadApp(html: string, title = 'Test app'): AppWindow {
		const doc = frame.contentDocument!;
		doc.title = title;
		doc.body.innerHTML = html;
		return frame.contentWindow as AppWindow;
	}

	function snapshotText(html: string, options?: IViewerSnapshotOptions): string {
		return createViewerBridge(loadApp(html)).snapshot(options).text;
	}

	/** Stubs the widget objects that Shiny's jQuery widgets keep for the slider and dropdown. */
	function stubShinyWidgets(win: AppWindow): void {
		const ionRangeSlider = { result: { from: 30, min: 1, max: 50 } };
		Object.assign(win, { jQuery: () => ({ data: () => ionRangeSlider }) });
		// The bridge reads plain fixture markup in another frame, not a React tree, so there's no RTL query for it.
		// eslint-disable-next-line no-restricted-syntax
		Object.assign(win.document.getElementById('color')!, {
			selectize: {
				options: {
					steelblue: { value: 'steelblue' },
					darkorange: { value: 'darkorange' },
					seagreen: { value: 'seagreen' },
				},
				settings: { valueField: 'value' },
				getValue: () => 'steelblue',
			},
		});
	}

	it('outlines a Shiny app, reading its jQuery widgets through their adapters', () => {
		const win = loadApp(SHINY_APP);
		stubShinyWidgets(win);

		const snapshot = createViewerBridge(win).snapshot();

		// The empty role="log" container is left out.
		expect(snapshot.text).toMatchInlineSnapshot(`
			"- heading "Viewer spike" [level=2]
			- complementary
			  - slider "Number of bins:" [ref=e1] value=30 min=1 max=50
			  - textbox "Plot title:" [ref=e2] value="Old Faithful"
			  - combobox "Bar color:" [ref=e3] value="steelblue" options=["steelblue","darkorange","seagreen"]
			  - button "Count clicks" [ref=e4]
			- main
			  - img "Plot object"
			  - text "Button clicked 0 times""
		`);
		expect({ title: snapshot.title, truncated: snapshot.truncated }).toEqual({ title: 'Test app', truncated: false });
	});

	it('lists only the controls with interactiveOnly', () => {
		const win = loadApp(SHINY_APP);
		stubShinyWidgets(win);

		expect(createViewerBridge(win).snapshot({ interactiveOnly: true }).text).toMatchInlineSnapshot(`
			"- slider "Number of bins:" [ref=e1] value=30 min=1 max=50
			- textbox "Plot title:" [ref=e2] value="Old Faithful"
			- combobox "Bar color:" [ref=e3] value="steelblue" options=["steelblue","darkorange","seagreen"]
			- button "Count clicks" [ref=e4]"
		`);
	});

	it('reads ARIA widgets: sliders, listbox options and popup dropdowns named from a wrapper label', () => {
		// Dash 4's markup: the component id (and so the <label for>) is on a wrapper.
		const text = snapshotText(`
			<label for="bins">Number of bins</label>
			<div id="bins"><span role="slider" tabindex="0" aria-valuenow="20" aria-valuemin="1" aria-valuemax="50"></span></div>
			<label for="color">Bar color</label>
			<div id="color"><button aria-haspopup="listbox" aria-expanded="false"><span>steelblue</span></button></div>
			<div role="listbox" aria-label="Units">
				<div role="option" aria-selected="true">minutes</div>
				<div role="option" aria-selected="false">seconds</div>
			</div>
			<div role="checkbox" aria-checked="false">Show data table</div>`);

		expect(text).toMatchInlineSnapshot(`
			"- slider "Number of bins" [ref=e1] value=20 min=1 max=50
			- combobox "Bar color" [ref=e2] value="steelblue"
			- listbox "Units"
			  - option "minutes" [ref=e3] selected
			  - option "seconds" [ref=e4]
			- checkbox "Show data table" [ref=e5] unchecked"
		`);
	});

	it('names a control from its other labels when aria-labelledby names nothing', () => {
		const text = snapshotText(`
			<span role="slider" aria-labelledby="missing" aria-label="Bins" aria-valuenow="5" aria-valuemin="1" aria-valuemax="50"></span>
			<label for="title">Plot title</label><input id="title" aria-labelledby="also-missing" value="Old Faithful">`);

		expect(text).toMatchInlineSnapshot(`
			"- slider "Bins" [ref=e1] value=5 min=1 max=50
			- textbox "Plot title" [ref=e2] value="Old Faithful""
		`);
	});

	it('marks disabled controls', () => {
		// The bridge checks :disabled, which in browsers also covers controls in a
		// disabled <fieldset>. happy-dom's :disabled only reads the element's own
		// attribute, so that case was checked in Chromium instead.
		const text = snapshotText(`
			<button disabled>Apply</button><input aria-label="Name" disabled>
			<span role="button" aria-disabled="true">Undo</span><button>Reset</button>`);

		expect(text).toMatchInlineSnapshot(`
			"- button "Apply" [ref=e1] disabled
			- textbox "Name" [ref=e2] value="" disabled
			- button "Undo" [ref=e3] disabled
			- button "Reset" [ref=e4]"
		`);
	});

	it('summarizes tables one row per line and walks rows that hold controls', () => {
		const text = snapshotText(`
			<table>
				<caption>Waiting times</caption>
				<tr><th>id</th><th>waiting</th></tr>
				<tr><td>1</td><td>74.1</td></tr>
				<tr><td>2</td><td><button>Details</button></td></tr>
			</table>`);

		expect(text).toMatchInlineSnapshot(`
			"- table "Waiting times"
			  - row "id | waiting"
			  - row "1 | 74.1"
			  - text "2"
			  - button "Details" [ref=e1]"
		`);
	});

	it('caps the rows it lists per table', () => {
		const rows = Array.from({ length: 60 }, (_, i) => `<tr><td>${i}</td></tr>`).join('');
		const lines = snapshotText(`<table>${rows}</table>`).split('\n');

		expect(lines.length).toBe(52);
		expect(lines.at(-1)).toBe('  - text "(up to 10 more rows)"');
	});

	it('doesn\'t list or count hidden and empty rows toward the cap', () => {
		// 60 data rows, each followed by an empty row and a hidden one.
		const rows = Array.from({ length: 60 }, (_, i) => `<tr><td>${i}</td></tr><tr><td></td></tr><tr style="display: none"><td>hidden</td></tr>`).join('');
		const lines = snapshotText(`<table>${rows}</table>`).split('\n');

		expect({ lines: lines.length, lastRow: lines.at(-2), more: lines.at(-1) }).toEqual({
			lines: 52,
			lastRow: '  - row "49"',
			more: '  - text "(up to 32 more rows)"',
		});
	});

	it('keeps visible content inside a visibility:hidden element', () => {
		// visibility:hidden hides the element's own content, but a descendant can make itself visible.
		expect(snapshotText('<div style="visibility: hidden">Hidden text<button style="visibility: visible">Shown</button></div>'))
			.toBe('- button "Shown" [ref=e1]');
	});

	it('reads the accessible table inside a canvas (Streamlit st.dataframe)', () => {
		// glide-data-grid draws the cells on the canvas and keeps the values in
		// fallback content, which is never rendered.
		const text = snapshotText(`
			<canvas aria-label="Data grid">
				<table role="grid">
					<thead role="rowgroup"><tr role="row"><th role="columnheader">waiting</th></tr></thead>
					<tbody role="rowgroup">
						<tr role="row"><td role="gridcell">74.147</td></tr>
						<tr role="row"><td role="gridcell">79.8594</td></tr>
					</tbody>
				</table>
			</canvas>`);

		expect(text).toMatchInlineSnapshot(`
			"- canvas "Data grid"
			  - grid
			    - row "waiting"
			    - row "74.147"
			    - row "79.8594""
		`);
	});

	it('summarizes Plotly charts from their data', () => {
		const win = loadApp('');
		const graph = win.document.createElement('div');
		graph.className = 'js-plotly-plot';
		graph.innerHTML = '<svg><text>0</text></svg>';
		win.document.body.appendChild(graph);
		Object.assign(graph, {
			data: [{ type: 'histogram' }],
			layout: { title: { text: 'Waiting times' } },
			calcdata: [[
				{ p: 42.5, s: 1, trace: { type: 'histogram' } },
				{ p: 47.5, s: 3 },
			]],
		});

		expect(createViewerBridge(win).snapshot().text).toMatchInlineSnapshot(`
			"- chart "Waiting times" (plotly)
			  - histogram n=2 [42.5:1 47.5:3]"
		`);
	});

	it('summarizes Plotly WebGL traces from their full data, which calcdata leaves out', () => {
		// scattergl's calcdata is a single placeholder point; the values are in _fullData.
		const win = loadApp('');
		const graph = win.document.createElement('div');
		graph.className = 'js-plotly-plot';
		graph.innerHTML = '<canvas></canvas>';
		win.document.body.appendChild(graph);
		Object.assign(graph, {
			data: [{ type: 'scattergl' }],
			layout: { title: { text: 'WebGL scatter' } },
			calcdata: [[{ x: false, y: false, trace: { type: 'scattergl' } }]],
			_fullData: [{ x: new Float64Array([1.5, 2.25, 3]), y: [4, 5, 6] }],
		});

		expect(createViewerBridge(win).snapshot().text).toMatchInlineSnapshot(`
			"- chart "WebGL scatter" (plotly)
			  - scattergl n=3 [1.5:4 2.25:5 3:6]"
		`);
	});

	it('leaves out Streamlit\'s hover toolbars', () => {
		expect(snapshotText(`
			<div data-testid="stElementToolbar"><button>Download as CSV</button><button>Fullscreen</button></div>
			<button>Count clicks</button>`)).toBe('- button "Count clicks" [ref=e1]');
	});

	it('keeps the text of containers with a role, and leaves out hidden content', () => {
		const text = snapshotText(`
			<div role="alert">Saved</div>
			<div hidden>hidden attribute</div>
			<div style="display: none">display none</div>
			<div aria-hidden="true">aria-hidden</div>
			<nav><a href="#top">Top</a></nav>`);

		expect(text).toMatchInlineSnapshot(`
			"- alert
			  - text "Saved"
			- navigation
			  - link "Top" [ref=e1]"
		`);
	});

	it('walks into open shadow roots, in the page and in same-origin iframes', () => {
		const win = loadApp('');
		const host = win.document.body.appendChild(win.document.createElement('my-widget'));
		host.attachShadow({ mode: 'open' }).innerHTML = '<button>In the page</button>';
		const innerDoc = win.document.body.appendChild(win.document.createElement('iframe')).contentDocument!;
		const innerHost = innerDoc.body.appendChild(innerDoc.createElement('div')).appendChild(innerDoc.createElement('my-widget'));
		innerHost.attachShadow({ mode: 'open' }).innerHTML = '<button>In the iframe</button>';

		expect(createViewerBridge(win).snapshot().text).toMatchInlineSnapshot(`
			"- button "In the page" [ref=e1]
			- iframe
			  - button "In the iframe" [ref=e2]"
		`);
	});

	it('limits the snapshot to a selector, and says when it matches nothing', () => {
		const bridge = createViewerBridge(loadApp('<h1>Title</h1><div id="part"><button>Go</button></div>'));

		expect(bridge.snapshot({ selector: '#part' }).text).toBe('- button "Go" [ref=e1]');
		expect(() => bridge.snapshot({ selector: '#missing' })).toThrow('Nothing in the Viewer matches the selector "#missing".');
	});

	it('cuts the snapshot at whole lines to fit maxChars', () => {
		const buttons = Array.from({ length: 20 }, (_, i) => `<button>Button ${i}</button>`).join('');
		const snapshot = createViewerBridge(loadApp(buttons)).snapshot({ maxChars: 100 });

		expect(snapshot.truncated).toBe(true);
		expect(snapshot.text.length).toBeLessThanOrEqual(100);
		expect(snapshot.text.split('\n').at(-1)).toMatch(/^- button "Button \d+" \[ref=e\d+\]$/);
	});

	it('says when nothing fits in maxChars, instead of calling the page empty', () => {
		const snapshot = createViewerBridge(loadApp('<h1>A heading far longer than the budget</h1>')).snapshot({ maxChars: 10 });

		expect({ text: snapshot.text, truncated: snapshot.truncated })
			.toEqual({ text: '(nothing fits in maxChars=10; ask for more)', truncated: true });
	});

	it('says when the page is empty', () => {
		expect(snapshotText('')).toBe('(no content)');
		expect(snapshotText('<p>Just text</p>', { interactiveOnly: true })).toBe('(no controls)');
	});
});

describe('act', () => {
	let frame: HTMLIFrameElement;
	let win: AppWindow;
	// The apps here are plain markup, so they settle at once.
	const QUICK = { quietMs: 10, timeoutMs: 1000 };

	beforeEach(() => {
		frame = mainWindow.document.createElement('iframe');
		mainWindow.document.body.appendChild(frame);
		win = frame.contentWindow as AppWindow;
	});

	afterEach(() => {
		frame.remove();
	});

	/**
	 * Loads the markup, runs `setup` (to stub framework widgets), then takes a
	 * snapshot, which hands out the refs.
	 */
	function load(html: string, setup?: () => void): IViewerBridge {
		win.document.body.innerHTML = html;
		setup?.();
		const bridge = createViewerBridge(win);
		bridge.snapshot();
		return bridge;
	}

	// The fixtures are plain markup in another frame, not a React tree, so there's no RTL query for them.
	// eslint-disable-next-line no-restricted-syntax
	const byId = (id: string) => win.document.getElementById(id)!;

	/** Records the events of the given types that reach an element. */
	function recordEvents(el: Element, types: readonly string[]): string[] {
		const events: string[] = [];
		for (const type of types) {
			el.addEventListener(type, () => events.push(type));
		}
		return events;
	}

	/** Makes an element an ARIA slider that moves by `step` for arrow keys and `page` for page keys. */
	function makeSlider(el: Element, { step = 1, page = 0 } = {}): string[] {
		const keys: string[] = [];
		el.addEventListener('keydown', event => {
			const key = (event as KeyboardEvent).key;
			keys.push(key);
			const deltas: Record<string, number> = { ArrowRight: step, ArrowLeft: -step, PageUp: page, PageDown: -page };
			const value = Number(el.getAttribute('aria-valuenow')) + (deltas[key] ?? 0);
			const clamped = Math.min(Number(el.getAttribute('aria-valuemax')), Math.max(Number(el.getAttribute('aria-valuemin')), value));
			el.setAttribute('aria-valuenow', String(clamped));
		});
		return keys;
	}

	/**
	 * Stubs Shiny's slider and dropdown widgets, and the inputs its server
	 * received. With `range`, the slider has two handles (from 30, to 40).
	 */
	function stubShiny({ serverUpdates = true, range = false } = {}): void {
		const inputValues: Record<string, unknown> = { bins: range ? [30, 40] : 30, color: 'steelblue' };
		const result = { from: 30, min: 1, max: 50 };
		const slider = { result, update: ({ from }: { from: number }) => result.from = Math.min(50, Math.max(1, from)) };
		const sendSlider = () => inputValues.bins = range ? [result.from, 40] : result.from;
		Object.assign(win, {
			jQuery: () => ({ data: () => slider, trigger: () => serverUpdates && sendSlider() }),
			Shiny: { shinyapp: { $inputValues: inputValues } },
		});
		let color = 'steelblue';
		const option = (value: string) => ({ value, label: value });
		Object.assign(byId('color'), {
			selectize: {
				options: { steelblue: option('steelblue'), darkorange: option('darkorange'), seagreen: option('seagreen') },
				settings: { valueField: 'value', labelField: 'label', maxItems: 1 },
				getValue: () => color,
				setValue: (value: string) => {
					color = value;
					if (serverUpdates) {
						inputValues.color = value;
					}
				},
			},
		});
	}

	it('keeps refs across snapshots, and gives new controls the next ones', () => {
		const bridge = load('<button id="one">One</button><button>Two</button>');
		const added = win.document.createElement('button');
		added.textContent = 'New';
		byId('one').before(added);

		expect(bridge.snapshot().text).toMatchInlineSnapshot(`
			"- button "New" [ref=e3]
			- button "One" [ref=e1]
			- button "Two" [ref=e2]"
		`);
	});

	it('clicks with the pointer and mouse events a user sends', async () => {
		const bridge = load('<button id="go">Go</button>');
		const events = recordEvents(byId('go'), ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);

		const outcome = await bridge.act({ kind: 'click', ref: 'e1' }, QUICK);

		expect({ outcome, events }).toEqual({
			outcome: { message: 'Clicked the button "Go".', navigated: false, timedOut: false },
			events: ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'],
		});
	});

	it('leaves focus where it is when the page cancels mousedown, as react-aria\'s options do', async () => {
		const bridge = load('<input id="color" aria-label="Bar color"><div role="option" id="option" tabindex="-1">darkorange</div>');
		byId('option').addEventListener('mousedown', event => event.preventDefault());
		byId('color').focus();

		await bridge.act({ kind: 'click', ref: 'e2' }, QUICK);

		expect(win.document.activeElement?.id).toBe('color');
	});

	it('checks that a click toggled a checkbox', async () => {
		const bridge = load('<label><input type="checkbox"> Show table</label><label><input type="checkbox" id="locked"> Locked</label>');
		byId('locked').addEventListener('click', event => event.preventDefault());

		const toggled = await bridge.act({ kind: 'click', ref: 'e1' }, QUICK);

		expect(toggled.message).toBe('Clicked the checkbox "Show table"; it\'s now checked.');
		await expect(bridge.act({ kind: 'click', ref: 'e2' }, QUICK)).rejects.toThrow('Clicked the checkbox "Locked", but it\'s still unchecked.');
	});

	it('fills a text box, then sends the events of leaving it rather than Enter', async () => {
		const bridge = load('<label for="name">Name</label><input id="name">');
		const events = recordEvents(byId('name'), ['input', 'change', 'blur', 'focusout', 'keydown']);

		const outcome = await bridge.act({ kind: 'fill', ref: 'e1', value: 'Hello' }, QUICK);

		expect({ message: outcome.message, value: (byId('name') as HTMLInputElement).value, events }).toEqual({
			message: 'Filled the textbox "Name" with "Hello".',
			value: 'Hello',
			events: ['input', 'change', 'blur', 'focusout'],
		});
	});

	it('says when the app undid a fill', async () => {
		const bridge = load('<input id="name" aria-label="Name" value="locked">');
		const input = byId('name') as HTMLInputElement;
		input.addEventListener('change', () => input.value = 'locked');

		await expect(bridge.act({ kind: 'fill', ref: 'e1', value: 'Hello' }, QUICK))
			.rejects.toThrow('Filled the textbox "Name", but it shows "locked", not "Hello".');
	});

	it('moves an ARIA slider through its own keyboard handling, page keys first', async () => {
		const bridge = load('<span role="slider" id="bins" aria-label="Bins" aria-valuenow="20" aria-valuemin="1" aria-valuemax="50"></span>');
		const keys = makeSlider(byId('bins'), { page: 10 });

		const outcome = await bridge.act({ kind: 'fill', ref: 'e1', value: '33' }, QUICK);

		expect({ message: outcome.message, value: byId('bins').getAttribute('aria-valuenow'), keys }).toEqual({
			message: 'Set the slider "Bins" to 33.',
			value: '33',
			keys: ['PageUp', 'PageUp', ...Array(7).fill('ArrowLeft')],
		});
	});

	it('moves a right-to-left slider, whose arrow keys work the other way round', async () => {
		const bridge = load('<span role="slider" id="bins" aria-label="Bins" aria-valuenow="20" aria-valuemin="1" aria-valuemax="50"></span>');
		const keys = makeSlider(byId('bins'), { step: -1 });

		const outcome = await bridge.act({ kind: 'fill', ref: 'e1', value: '23' }, QUICK);

		expect({ message: outcome.message, value: byId('bins').getAttribute('aria-valuenow'), keys }).toEqual({
			message: 'Set the slider "Bins" to 23.',
			value: '23',
			keys: ['PageUp', 'ArrowRight', ...Array(4).fill('ArrowLeft')],
		});
	});

	it('reads a slider\'s value from its text when it has no aria-valuenow', async () => {
		const bridge = load('<span role="slider" id="wait" aria-label="Wait" aria-valuetext="20 minutes" aria-valuemin="1" aria-valuemax="50"></span>');
		const slider = byId('wait');
		slider.addEventListener('keydown', event => {
			const deltas: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
			slider.setAttribute('aria-valuetext', `${parseFloat(slider.getAttribute('aria-valuetext')!) + (deltas[(event as KeyboardEvent).key] ?? 0)} minutes`);
		});

		const outcome = await bridge.act({ kind: 'fill', ref: 'e1', value: '22' }, QUICK);

		expect({ message: outcome.message, shown: slider.getAttribute('aria-valuetext') }).toEqual({ message: 'Set the slider "Wait" to 22.', shown: '22 minutes' });
	});

	it('stops a slider at the closest value its steps allow, and says so', async () => {
		const bridge = load('<span role="slider" id="n" aria-label="Sample size" aria-valuenow="10" aria-valuemin="0" aria-valuemax="100"></span>');
		makeSlider(byId('n'), { step: 5 });

		const outcome = await bridge.act({ kind: 'fill', ref: 'e1', value: '13' }, QUICK);

		expect(outcome.message).toBe('Set the slider "Sample size" to 15, the closest it goes to 13.');
	});

	it('moves a range input with keys when a widget handles them, as Streamlit\'s react-aria slider does', async () => {
		const bridge = load('<label for="bins">Bins</label><input type="range" id="bins" min="1" max="50" value="20">');
		const input = byId('bins') as HTMLInputElement;
		// react-aria reports a change to the app only when it moves the value for a key.
		const reported: string[] = [];
		input.addEventListener('keydown', event => {
			const deltas: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, PageUp: 5, PageDown: -5 };
			input.value = String(Number(input.value) + (deltas[(event as KeyboardEvent).key] ?? 0));
			reported.push(input.value);
		});

		const outcome = await bridge.act({ kind: 'fill', ref: 'e1', value: '27' }, QUICK);

		expect({ message: outcome.message, reported }).toEqual({ message: 'Set the slider "Bins" to 27.', reported: ['25', '30', '29', '28', '27'] });
	});

	it('sets a plain range input by its value', async () => {
		const bridge = load('<label for="bins">Bins</label><input type="range" id="bins" min="1" max="50" value="30">');

		const outcome = await bridge.act({ kind: 'fill', ref: 'e1', value: '10' }, QUICK);

		expect({ message: outcome.message, value: (byId('bins') as HTMLInputElement).value }).toEqual({ message: 'Set the slider "Bins" to 10.', value: '10' });
	});

	it('drives Shiny\'s slider and dropdown through their widgets', async () => {
		const bridge = load(SHINY_APP, () => stubShiny());

		const messages = [
			(await bridge.act({ kind: 'fill', ref: 'e1', value: '10' }, QUICK)).message,
			(await bridge.act({ kind: 'select', ref: 'e3', value: 'seagreen' }, QUICK)).message,
		];

		expect(messages).toEqual(['Set the slider "Number of bins:" to 10.', 'Picked "seagreen" in the combobox "Bar color:".']);
	});

	it('checks the from handle of a two-handle Shiny slider, which the server gets as [from, to]', async () => {
		const bridge = load(SHINY_APP, () => stubShiny({ range: true }));

		const outcome = await bridge.act({ kind: 'fill', ref: 'e1', value: '20' }, QUICK);

		expect(outcome.message).toBe('Set the slider "Number of bins:" to 20.');
	});

	it('says when a Shiny app\'s server didn\'t get the value the page shows', async () => {
		const bridge = load(SHINY_APP, () => stubShiny({ serverUpdates: false }));

		await expect(bridge.act({ kind: 'fill', ref: 'e1', value: '10' }, QUICK))
			.rejects.toThrow('The slider "Number of bins:" shows "10" on the page, but the Shiny app received "30".');
	});

	it('picks an option in a native select by its text or value, and lists the options when none match', async () => {
		const bridge = load('<label for="color">Bar color</label><select id="color"><option value="blue">Steel blue</option><option value="orange">Dark orange</option></select>');

		const outcome = await bridge.act({ kind: 'select', ref: 'e1', value: 'Dark orange' }, QUICK);

		expect({ message: outcome.message, value: (byId('color') as HTMLSelectElement).value })
			.toEqual({ message: 'Picked "Dark orange" in the combobox "Bar color".', value: 'orange' });
		await expect(bridge.act({ kind: 'fill', ref: 'e1', value: 'purple' }, QUICK))
			.rejects.toThrow('The combobox "Bar color" has no option "purple" (its options: "Steel blue", "Dark orange").');
	});

	it('picks in a combobox by typing the option and taking the first match', async () => {
		const bridge = load('<label for="color">Bar color</label><input id="color" role="combobox" value="steelblue">');
		const input = byId('color') as HTMLInputElement;
		// Like Streamlit's selectbox: Enter takes the first option matching the text, and leaving shows the choice.
		let chosen = 'steelblue';
		input.addEventListener('keydown', event => {
			if ((event as KeyboardEvent).key === 'Enter') {
				chosen = ['steelblue', 'darkorange'].find(option => option.startsWith(input.value)) ?? chosen;
			}
		});
		input.addEventListener('blur', () => input.value = chosen);

		const outcome = await bridge.act({ kind: 'select', ref: 'e1', value: 'darkorange' }, QUICK);

		expect(outcome.message).toBe('Picked "darkorange" in the combobox "Bar color".');
		await expect(bridge.act({ kind: 'select', ref: 'e1', value: 'purple' }, QUICK))
			.rejects.toThrow('Picked "purple" in the combobox "Bar color", but it shows "darkorange".');
	});

	it('picks the combobox option with exactly the text, not the first one that contains it', async () => {
		const bridge = load('<label for="color">Bar color</label><input id="color" role="combobox" aria-controls="list" value="steelblue"><div role="listbox" id="list"></div>');
		const input = byId('color') as HTMLInputElement;
		const list = byId('list');
		// Like Streamlit's selectbox: typing filters the list, and clicking an option picks it.
		input.addEventListener('input', () => list.replaceChildren(...['dark green', 'green']
			.filter(text => text.includes(input.value))
			.map(text => {
				const option = win.document.createElement('div');
				option.setAttribute('role', 'option');
				option.textContent = text;
				option.addEventListener('click', () => input.value = text);
				return option;
			})));

		const outcome = await bridge.act({ kind: 'select', ref: 'e1', value: 'green' }, QUICK);

		expect({ message: outcome.message, value: input.value }).toEqual({ message: 'Picked "green" in the combobox "Bar color".', value: 'green' });
		await expect(bridge.act({ kind: 'select', ref: 'e1', value: 'gree' }, QUICK))
			.rejects.toThrow('The combobox "Bar color" has no option "gree" (options with that text: "dark green", "green").');
	});

	it('keeps free text filled into a combobox that only suggests options', async () => {
		const bridge = load('<input id="search" role="combobox" aria-label="Search" aria-controls="hints"><div role="listbox" id="hints"><div role="option">Old Faithful dataset</div></div>');

		const outcome = await bridge.act({ kind: 'fill', ref: 'e1', value: 'Old' }, QUICK);

		expect({ message: outcome.message, value: (byId('search') as HTMLInputElement).value })
			.toEqual({ message: 'Filled the combobox "Search" with "Old".', value: 'Old' });
	});

	it('opens a popup dropdown and clicks the option in it', async () => {
		// Dash 4's dcc.Dropdown: the component id, and so the label, is on a wrapper.
		const bridge = load('<label for="color">Bar color</label><div id="color"><button id="open" aria-haspopup="listbox"><span>steelblue</span></button></div>');
		const button = byId('open');
		button.addEventListener('click', () => {
			const popup = win.document.createElement('div');
			popup.setAttribute('role', 'listbox');
			for (const text of ['steelblue', 'darkorange']) {
				const option = popup.appendChild(win.document.createElement('div'));
				option.setAttribute('role', 'option');
				option.textContent = text;
				option.addEventListener('click', () => {
					button.firstElementChild!.textContent = text;
					popup.remove();
				});
			}
			win.document.body.appendChild(popup);
		});

		const outcome = await bridge.act({ kind: 'select', ref: 'e1', value: 'darkorange' }, QUICK);

		expect({ message: outcome.message, shown: button.textContent }).toEqual({ message: 'Picked "darkorange" in the combobox "Bar color".', shown: 'darkorange' });
	});

	it('presses a key in a control', async () => {
		const bridge = load('<input id="chat" aria-label="Message">');
		const keys: string[] = [];
		byId('chat').addEventListener('keydown', event => keys.push(`${(event as KeyboardEvent).key}/${(event as KeyboardEvent).code}`));

		const outcome = await bridge.act({ kind: 'press', key: 'Enter', ref: 'e1' }, QUICK);

		expect({ message: outcome.message, keys }).toEqual({ message: 'Pressed Enter in the textbox "Message".', keys: ['Enter/Enter'] });
	});

	it('scrolls a control\'s own scrolling area or the page, never an unrelated one', async () => {
		const bridge = load('<button>Go</button><div id="table" style="overflow-y: auto; height: 100px"></div>');
		// A scrolling area elsewhere on the page, which the button isn't in.
		const table = byId('table');
		Object.defineProperties(table, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 }, scrollTop: { value: 0, writable: true } });

		const outcome = await bridge.act({ kind: 'scroll', ref: 'e1', dy: 300 }, QUICK);

		expect({ tableTop: table.scrollTop, page: outcome.message.includes('the page') }).toEqual({ tableTop: 0, page: true });
	});

	it('waits for text to show up, including where only the snapshot sees it (a shadow root)', async () => {
		const bridge = load('<div id="out">Loading</div><div id="host"></div>');
		const shadow = byId('host').attachShadow({ mode: 'open' });
		win.setTimeout(() => {
			byId('out').textContent = 'Done: 42 rows';
			shadow.innerHTML = '<p>Chart drawn</p>';
		}, 50);
		const waitFor = (text: string, timeoutMs = 2000) => bridge.act({ kind: 'wait', for: 'text', text, timeoutMs }, QUICK);

		expect((await waitFor('Done')).message).toMatch(/^The text "Done" is on the page \(after \d+ ms\)\.$/);
		expect((await waitFor('Chart drawn')).message).toMatch(/^The text "Chart drawn" is on the page/);
		await expect(waitFor('Never', 100)).rejects.toThrow('The text "Never" didn\'t show up on the page within 100 ms.');
	});

	it('reports a page going to another address, rather than waiting on it', async () => {
		const bridge = load('<a href="/next" id="next">Next</a>');
		byId('next').addEventListener('click', event => {
			// Stand in for the navigation, which the test page can't do.
			event.preventDefault();
			win.dispatchEvent(new win.Event('pagehide'));
		});

		const outcome = await bridge.act({ kind: 'click', ref: 'e1' }, { quietMs: 2000, timeoutMs: 2000 });

		expect(outcome).toEqual({ message: 'Clicked the link "Next". The page went to another address.', navigated: true, timedOut: false });
	});

	it('refuses controls it can\'t use, with a way forward', async () => {
		const bridge = load('<button id="gone">Gone</button><button disabled>Off</button><div id="box"><button>Later hidden</button></div>');
		byId('gone').remove();
		byId('box').style.display = 'none';

		const errors = await Promise.all(['e1', 'e2', 'e3', 'e99'].map(ref =>
			bridge.act({ kind: 'click', ref }, QUICK).then(() => 'ok', (error: Error) => error.message)));

		expect(errors).toEqual([
			'The control e1 is gone from the page, probably because the app redrew it. Take a new snapshot and use a ref from it.',
			'The button "Off" is disabled.',
			'The button "Later hidden" is hidden right now. Take a new snapshot to see what\'s showing.',
			'There\'s no control e99 on this page. Take a new snapshot and use a ref from it.',
		]);
	});

	it('explains actions it can\'t make sense of', async () => {
		const bridge = load('<input aria-label="Name"><div role="listbox" aria-label="Units"><div role="option">minutes</div></div>');
		// Actions arrive from extensions, so they can be malformed.
		const malformed = [{ kind: 'drag', ref: 'e1' }, { kind: 'fill', ref: 'e1' }, { kind: 'wait', for: 'forever' }, { kind: 'select', ref: 'e2', value: 'minutes' }];

		const errors = await Promise.all(malformed.map(action =>
			bridge.act(action as unknown as ViewerAction, QUICK).then(() => 'ok', (error: Error) => error.message)));

		expect(errors).toEqual([
			'Unknown action "drag". Use click, hover, fill, select, press, scroll or wait.',
			'fill needs a value, as a string.',
			'A wait needs "for": "idle" or "text".',
			'Can\'t select in the option "minutes". select works on dropdowns; to pick an option in a list, click the option.',
		]);
	});
});

describe('waitForIdle', () => {
	let frame: HTMLIFrameElement;
	let win: AppWindow;

	beforeEach(() => {
		frame = mainWindow.document.createElement('iframe');
		mainWindow.document.body.appendChild(frame);
		win = frame.contentWindow as AppWindow;
	});

	afterEach(() => {
		frame.remove();
	});

	it('resolves once the page has been quiet, but not while Shiny is busy', async () => {
		const bridge = createViewerBridge(win);
		const quiet = await bridge.waitForIdle({ quietMs: 20, timeoutMs: 1000 });
		win.document.documentElement.classList.add('shiny-busy');
		const busy = await bridge.waitForIdle({ quietMs: 20, timeoutMs: 200 });

		expect({ quiet: quiet.timedOut, busy: busy.timedOut }).toEqual({ quiet: false, busy: true });
	});
});

describe('viewerBridgeScript', () => {
	let frame: HTMLIFrameElement;

	beforeEach(() => {
		frame = mainWindow.document.createElement('iframe');
		mainWindow.document.body.appendChild(frame);
	});

	afterEach(() => {
		frame.remove();
	});

	// On Desktop the bridge is serialized and run in the app's own frame, so it
	// must not depend on anything outside createViewerBridge's body.
	function runInApp(script: string): Promise<unknown> {
		return (frame.contentWindow as AppWindow).eval(script);
	}

	it('runs a bridge method inside the app frame, where a missing argument arrives as null', async () => {
		frame.contentDocument!.body.innerHTML = '<button>Go</button>';

		const result = await runInApp(viewerBridgeScript('snapshot', [undefined]));

		expect(result).toEqual({ ok: true, value: { text: '- button "Go" [ref=e1]', url: 'about:blank', title: '', truncated: false } });
	});

	it('keeps refs between runs in the app frame, so an action can use a snapshot\'s refs', async () => {
		frame.contentDocument!.body.innerHTML = '<button>Go</button>';

		await runInApp(viewerBridgeScript('snapshot', [undefined]));
		const result = await runInApp(viewerBridgeScript('act', [{ kind: 'click', ref: 'e1' }, { quietMs: 10 }]));

		expect(result).toEqual({ ok: true, value: { message: 'Clicked the button "Go".', navigated: false, timedOut: false } });
	});

	it('reports errors as data', async () => {
		const result = await runInApp(viewerBridgeScript('snapshot', [{ selector: '#missing' }]));

		expect(result).toEqual({ ok: false, error: 'Nothing in the Viewer matches the selector "#missing".' });
	});
});
