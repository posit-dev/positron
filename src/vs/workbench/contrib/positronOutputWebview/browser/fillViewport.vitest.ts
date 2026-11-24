/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FILL_VIEWPORT_CSS } from './fillViewport.js';

/** The selector of the rule that sets `declaration`, so it can be checked with Element.matches(). */
function selectorFor(declaration: string): string {
	const rule = [...FILL_VIEWPORT_CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(m => m[2].includes(declaration));
	if (!rule) {
		throw new Error(`no rule sets ${declaration}`);
	}
	return rule[1].replace('<style>', '').trim();
}

/** Renders `html` into the body and returns the ids of elements matching `selector`. */
function matchedIds(html: string, selector: string): string[] {
	document.body.innerHTML = html;
	// eslint-disable-next-line no-restricted-syntax -- checks CSS selector matching on raw markup, not a rendered component
	return Array.from(document.querySelectorAll('[id]'))
		.filter(el => el.matches(selector))
		.map(el => el.id);
}

/** Returns the ids of elements the fill CSS gives a height. */
function filledIds(html: string): string[] {
	return matchedIds(html, selectorFor('height: 100%'));
}

describe('FILL_VIEWPORT_CSS', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('fills a chart without the actions menu (Altair HTML output)', () => {
		expect(filledIds(`
			<div id="output" class="output_html">
				<div id="embed" class="vega-embed fit-y"><svg id="marks"></svg></div>
			</div>`)).toEqual(['output', 'embed']);
	});

	it('fills a chart with the actions menu (Altair 5)', () => {
		expect(filledIds(`
			<div id="output">
				<div id="embed" class="vega-embed">
					<div id="wrapper" class="chart-wrapper fit-y"><svg id="marks"></svg></div>
				</div>
			</div>`)).toEqual(['output', 'embed']);
	});

	it('leaves a Vega chart with a fixed height unchanged', () => {
		expect(filledIds(`
			<div id="output">
				<div id="embed" class="vega-embed">
					<div id="wrapper" class="chart-wrapper"><svg id="marks"></svg></div>
				</div>
			</div>`)).toEqual([]);
	});

	it('shows the chart as a block, so it does not overflow the pane', () => {
		const selector = selectorFor('display: block');
		expect(matchedIds(`
			<div id="embed" class="vega-embed has-actions">
				<div id="wrapper" class="chart-wrapper fit-x fit-y"><canvas id="marks" class="marks"></canvas></div>
			</div>`, selector)).toEqual(['marks']);
		expect(matchedIds(`
			<div id="embed" class="vega-embed"><svg id="marks" class="marks"></svg></div>`, selector)).toEqual([]);
	});

	it('takes the actions button out of the layout beside a container-width chart', () => {
		const selector = selectorFor('position: absolute');
		// Altair 5 sets fit-x only on the wrapper; Altair 6 also sets it on the embed.
		expect(matchedIds(`
			<div id="embed" class="vega-embed has-actions">
				<div class="chart-wrapper fit-x fit-y"></div><details id="actions"></details>
			</div>`, selector)).toEqual(['actions']);
		expect(matchedIds(`
			<div id="embed" class="vega-embed has-actions fit-x fit-y">
				<div class="chart-wrapper fit-x fit-y"></div><details id="actions"></details>
			</div>`, selector)).toEqual(['actions']);
		expect(matchedIds(`
			<div id="embed" class="vega-embed has-actions">
				<div class="chart-wrapper"></div><details id="actions"></details>
			</div>`, selector)).toEqual([]);
	});

	it('clips a container-size chart so a pane resize does not add scrollbars', () => {
		const selector = selectorFor('overflow: hidden');
		expect(matchedIds(`
			<div id="embed" class="vega-embed has-actions fit-x fit-y">
				<div id="wrapper" class="chart-wrapper fit-x fit-y"><svg class="marks"></svg><form class="vega-bindings"></form></div><details></details>
			</div>`, selector)).toEqual(['wrapper']);
		expect(matchedIds(`
			<div id="embed" class="vega-embed fit-x fit-y"><svg class="marks"></svg></div>`, selector)).toEqual(['embed']);
		// A fixed width or height can exceed the pane, so the pane must still scroll to it.
		for (const fit of ['fit-x', 'fit-y']) {
			expect(matchedIds(`
				<div id="embed" class="vega-embed has-actions">
					<div id="wrapper" class="chart-wrapper ${fit}"><svg class="marks"></svg><form class="vega-bindings"></form></div>
				</div>`, selector)).toEqual([]);
		}
		// Input controls sit below the chart, inside the same box.
		expect(matchedIds(`
			<div id="embed" class="vega-embed has-actions">
				<div id="wrapper" class="chart-wrapper fit-x fit-y"><svg class="marks"></svg><form class="vega-bindings"><input></form></div>
			</div>`, selector)).toEqual([]);
	});
});
