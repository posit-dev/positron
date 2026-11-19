/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CSS for a webview with a fixed size, such as the Plots pane, that lets
 * Vega and Vega-Lite (e.g. Altair) charts with `height: "container"` fill it.
 *
 * Such a chart reads its height from its parent, but no element above it has
 * a height, so it collapses to zero and grows on each resize (#4892). Vega
 * marks these charts with the `fit-y` class, so this CSS gives a height only
 * to them and to the elements that contain them. Other outputs are unchanged.
 *
 * Vega puts `fit-y` on `.vega-embed`, or on its `.chart-wrapper` child when the
 * actions menu is shown, so both are matched. Every element that contains either
 * one, `.vega-embed` included, matches the `:has()` rule.
 *
 * Scrollbars are hidden because Vega measures its container while the pane
 * shrinks; a scrollbar shown then would leave the chart that much too small.
 */
export const FILL_VIEWPORT_CSS = `
<style>
	:has(.vega-embed.fit-y, .chart-wrapper.fit-y),
	.vega-embed.fit-y,
	.vega-embed.fit-y > .chart-wrapper {
		height: 100%;
	}
	html:has(.vega-embed.fit-y, .chart-wrapper.fit-y) {
		overflow: hidden;
	}
</style>`;
