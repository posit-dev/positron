/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FILL_VIEWPORT_CSS } from './fillViewport.js';

// The rule's selector list, so it can be checked with Element.matches().
const selector = FILL_VIEWPORT_CSS.match(/<style>([\s\S]*)\{/)![1].trim();

/** Renders `html` into the body and returns the ids of elements the fill CSS gives a height. */
function filledIds(html: string): string[] {
	document.body.innerHTML = html;
	// eslint-disable-next-line no-restricted-syntax -- checks CSS selector matching on raw markup, not a rendered component
	return Array.from(document.querySelectorAll('[id]'))
		.filter(el => el.matches(selector))
		.map(el => el.id);
}

describe('FILL_VIEWPORT_CSS', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('fills a chart whose outer element has fit-y (Altair HTML output)', () => {
		expect(filledIds(`
			<div id="output" class="output_html">
				<div id="embed" class="vega-embed fit-y">
					<div id="wrapper" class="chart-wrapper fit-y"><svg id="marks"></svg></div>
				</div>
			</div>`)).toEqual(['output', 'embed', 'wrapper']);
	});

	it('fills a chart whose inner wrapper has fit-y (actions menu shown)', () => {
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

	it('leaves other outputs unchanged', () => {
		expect(filledIds(`<div id="output" class="output_html"><img id="img"></div>`)).toEqual([]);
	});
});
