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
 * - Actions button: Altair keeps it in the layout, but it is added after Vega first
 *   measures, so the chart width changed between draws. Taking it out of the layout
 *   puts it in the padding Vega reserves for it, as Vega's own CSS does. Altair's
 *   rule is keyed on the chart id, so overriding it needs !important.
 * - Clip: after the pane shrinks, the old chart overflows until Vega redraws, and
 *   Vega measures the scrollbars that adds. Only charts sized to the pane both
 *   ways: a fixed width or height can exceed the pane and must scroll. Charts with
 *   input controls are left alone, since the controls sit below the chart in the
 *   same box.
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
	.fit-x.fit-y:has(> .marks):not(:has(> .vega-bindings:not(:empty))) {
		overflow: hidden;
	}
	.vega-embed:has(> .chart-wrapper.fit-x) > details {
		position: absolute !important;
		top: 0;
		right: 0;
	}
</style>`;
