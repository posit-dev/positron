/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CSS for a fixed-size webview, such as the Plots pane, so Vega charts with
 * `height: "container"` fill it instead of collapsing to zero (#4892).
 *
 * - Height: Vega marks these charts `fit-y`, on `.vega-embed` or, when the actions
 *   menu shows, on `.chart-wrapper`, which Vega's own CSS sizes. Only the elements
 *   above the chart get a height.
 * - Block marks: an inline chart sits on the text baseline and overflows by a few
 *   pixels; the scrollbar that adds takes width from the chart.
 * - Actions button: it takes width only after Vega first measures, which changed
 *   the chart width between draws. With no width it sits in Vega's padding.
 */
export const FILL_VIEWPORT_CSS = `
<style>
	:has(.vega-embed.fit-y, .chart-wrapper.fit-y),
	.vega-embed.fit-y {
		height: 100%;
	}
	.fit-y > .marks {
		display: block;
	}
	.vega-embed:has(> .chart-wrapper.fit-x) > details {
		width: 0;
		min-width: 0;
	}
</style>`;
