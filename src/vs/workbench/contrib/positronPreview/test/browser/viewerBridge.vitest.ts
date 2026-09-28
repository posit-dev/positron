/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { mainWindow } from '../../../../../base/browser/window.js';
import { createViewerBridge, viewerBridgeScript } from '../../browser/viewerBridge.js';
import { IViewerSnapshotOptions } from '../../common/positronViewerAgent.js';

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
		expect(lines.at(-1)).toBe('  - text "(10 more rows)"');
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

	it('walks into open shadow roots', () => {
		const win = loadApp('');
		const host = win.document.createElement('my-widget');
		win.document.body.appendChild(host);
		host.attachShadow({ mode: 'open' }).innerHTML = '<button>Inside</button>';

		expect(createViewerBridge(win).snapshot().text).toBe('- button "Inside" [ref=e1]');
	});

	it('limits the snapshot to a selector', () => {
		expect(snapshotText('<h1>Title</h1><div id="part"><button>Go</button></div>', { selector: '#part' }))
			.toBe('- button "Go" [ref=e1]');
	});

	it('reports a selector that matches nothing', () => {
		const bridge = createViewerBridge(loadApp('<p>Hi</p>'));

		expect(() => bridge.snapshot({ selector: '#missing' })).toThrow('Nothing in the Viewer matches the selector "#missing".');
	});

	it('cuts the snapshot at whole lines to fit maxChars', () => {
		const buttons = Array.from({ length: 20 }, (_, i) => `<button>Button ${i}</button>`).join('');
		const snapshot = createViewerBridge(loadApp(buttons)).snapshot({ maxChars: 100 });

		expect(snapshot.truncated).toBe(true);
		expect(snapshot.text.length).toBeLessThanOrEqual(100);
		expect(snapshot.text.split('\n').at(-1)).toMatch(/^- button "Button \d+" \[ref=e\d+\]$/);
	});

	it('says when the page is empty', () => {
		expect(snapshotText('')).toBe('(no content)');
		expect(snapshotText('<p>Just text</p>', { interactiveOnly: true })).toBe('(no controls)');
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

	it('resolves once the page has been quiet', async () => {
		const result = await createViewerBridge(win).waitForIdle({ quietMs: 20, timeoutMs: 1000 });

		expect(result.timedOut).toBe(false);
	});

	it('keeps waiting while Shiny is busy', async () => {
		win.document.documentElement.classList.add('shiny-busy');

		const result = await createViewerBridge(win).waitForIdle({ quietMs: 20, timeoutMs: 200 });

		expect(result.timedOut).toBe(true);
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

	it('runs a bridge method inside the app frame', async () => {
		frame.contentDocument!.body.innerHTML = '<button>Go</button>';

		const result = await runInApp(viewerBridgeScript('snapshot', [{ interactiveOnly: true }]));

		expect(result).toEqual({ ok: true, value: { text: '- button "Go" [ref=e1]', url: 'about:blank', title: '', truncated: false } });
	});

	it('treats a missing options argument, which arrives as null, as no options', async () => {
		frame.contentDocument!.body.innerHTML = '<button>Go</button>';

		const result = await runInApp(viewerBridgeScript('snapshot', [undefined]));

		expect(result).toEqual({ ok: true, value: { text: '- button "Go" [ref=e1]', url: 'about:blank', title: '', truncated: false } });
	});

	it('reports errors as data', async () => {
		const result = await runInApp(viewerBridgeScript('snapshot', [{ selector: '#missing' }]));

		expect(result).toEqual({ ok: false, error: 'Nothing in the Viewer matches the selector "#missing".' });
	});
});
