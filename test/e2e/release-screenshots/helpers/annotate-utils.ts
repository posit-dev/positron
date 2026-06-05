/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from '@playwright/test';

/**
 * One labeled region. The border is rendered as a separate fixed-position
 * overlay (not inset on the element) so child content can't paint over it
 * and parent overflow can't clip it. The label is also rendered as a
 * fixed-position badge anchored near a corner of the region.
 */
export type Annotation = {
	/**
	 * CSS selector that resolves to the region's element. Pass an array to
	 * outline the union of multiple elements (e.g. when the natural wrapper
	 * has padding or fixed width that's too wide).
	 */
	selector: string | string[];
	/** Text shown on the label badge. Pass '' to draw the border without a label. */
	label: string;
	/** Border + badge color (any CSS color string). */
	color: string;
	/** Where to anchor the label badge relative to the region. Default 'top-left'. */
	labelPosition?:
	| 'top-left'
	| 'top-center'
	| 'top-right'
	| 'bottom-right'
	| 'above-left'
	| 'above-center'
	| 'below-left'
	| 'below-center'
	| 'right-outside'
	| 'left-outside';
	/** Pixels to expand the border outward on all sides. Default 0. */
	padding?: number;
	/** Border stroke width in pixels. Default 3 (matches the docs styling for full-window shots). */
	borderWidth?: number;
};

/**
 * Draw borders and labels for the given regions, then leave them in place
 * for `page.screenshot()` to capture. Mutations live until navigation or
 * app restart - which is fine for one-shot screenshot tests.
 *
 * Implementation note: borders are rendered as fixed-position overlays
 * appended to <body>, sized from each element's bounding rect. This keeps
 * them above all child content (the editor/sidebar/panel children fill
 * their parents completely, so an inset box-shadow gets painted over) and
 * unaffected by parent overflow:hidden clipping.
 */
/**
 * Remove any annotation borders/badges left over from a prior `annotate()`
 * call. Tests that don't themselves call `annotate` but share a page with a
 * test that did should call this in cleanup or before capture.
 */
export async function clearAnnotations(page: Page): Promise<void> {
	await page.evaluate(() => {
		document
			.querySelectorAll('[data-screenshot-annotation]')
			.forEach((el) => el.remove());
	});
}

/**
 * Paint a solid backdrop rectangle on the page. Sits just below the
 * annotation border/badge layer, so `right-outside` / `left-outside`
 * badges render on a clean surface instead of whatever workbench content
 * happens to be behind the picker. Coordinates are in CSS pixels.
 */
export async function paintBackdrop(
	page: Page,
	rect: { x: number; y: number; width: number; height: number },
	color: string = '#ffffff',
): Promise<void> {
	await page.evaluate(({ rect, color }) => {
		const el = document.createElement('div');
		el.dataset.screenshotAnnotation = 'backdrop';
		el.style.cssText = [
			'position:fixed',
			`top:${rect.y}px`,
			`left:${rect.x}px`,
			`width:${rect.width}px`,
			`height:${rect.height}px`,
			`background:${color}`,
			'z-index:99997',
			'pointer-events:none',
		].join(';');
		document.body.appendChild(el);
	}, { rect, color });
}

export async function annotate(page: Page, items: Annotation[]): Promise<void> {
	await page.evaluate((items) => {
		const DEFAULT_BORDER_PX = 3;
		const Z = 99998;

		// Remove any borders/badges from a prior annotate() call so subsequent
		// tests in the same suite don't inherit them. Backdrops painted via
		// paintBackdrop() are left alone — callers may paint them before or
		// after annotate(). `clearAnnotations()` (called from afterEach)
		// removes both kinds at end of test.
		document
			.querySelectorAll('[data-screenshot-annotation="border"], [data-screenshot-annotation="label"]')
			.forEach((el) => el.remove());

		for (const { selector, label, color, labelPosition = 'top-left', padding = 0, borderWidth = DEFAULT_BORDER_PX } of items) {
			const selectors = Array.isArray(selector) ? selector : [selector];
			const elRects: DOMRect[] = [];
			for (const sel of selectors) {
				const el = document.querySelector(sel) as HTMLElement | null;
				if (!el) {
					console.warn(`[annotate] selector not found: ${sel}`);
					continue;
				}
				const r = el.getBoundingClientRect();
				if (r.width === 0 || r.height === 0) {
					console.warn(`[annotate] zero-size region: ${sel}`);
					continue;
				}
				elRects.push(r);
			}
			if (elRects.length === 0) {
				continue;
			}
			// Union: tightest rect containing all matched elements.
			const unionTop = Math.min(...elRects.map((r) => r.top));
			const unionLeft = Math.min(...elRects.map((r) => r.left));
			const unionRight = Math.max(...elRects.map((r) => r.right));
			const unionBottom = Math.max(...elRects.map((r) => r.bottom));
			const rect = {
				top: unionTop - padding,
				left: unionLeft - padding,
				right: unionRight + padding,
				bottom: unionBottom + padding,
				width: unionRight - unionLeft + padding * 2,
				height: unionBottom - unionTop + padding * 2,
			};

			// Border overlay - fixed position, sized from the rect.
			const border = document.createElement('div');
			border.dataset.screenshotAnnotation = 'border';
			border.style.cssText = [
				'position:fixed',
				`top:${rect.top}px`,
				`left:${rect.left}px`,
				`width:${rect.width}px`,
				`height:${rect.height}px`,
				`border:${borderWidth}px solid ${color}`,
				'box-sizing:border-box',
				'pointer-events:none',
				`z-index:${Z}`,
			].join(';');
			document.body.appendChild(border);

			// Skip the badge entirely if no label was provided.
			if (!label) {
				continue;
			}

			// Label badge - fixed position, anchored near the chosen corner.
			// Allowed to overflow the region horizontally if the label is
			// wider than the region (e.g. 'Activity bar' inside the narrow
			// Activity bar column).
			const PAD = 6;
			const BADGE_H = 20; // matches the fixed badge height set below
			const anchor =
				labelPosition === 'top-center' ? `top:${rect.top + PAD}px;left:${rect.left + rect.width / 2}px;transform:translateX(-50%);` :
					labelPosition === 'top-right' ? `top:${rect.top + PAD}px;right:${window.innerWidth - rect.right + PAD}px;` :
						labelPosition === 'bottom-right' ? `top:${rect.bottom - PAD - BADGE_H}px;right:${window.innerWidth - rect.right + PAD}px;` :
							labelPosition === 'above-center' ? `top:${rect.top - BADGE_H - PAD}px;left:${rect.left + rect.width / 2}px;transform:translateX(-50%);` :
								labelPosition === 'above-left' ? `top:${rect.top - BADGE_H - PAD}px;left:${rect.left}px;` :
									labelPosition === 'below-center' ? `top:${rect.bottom + PAD}px;left:${rect.left + rect.width / 2}px;transform:translateX(-50%);` :
										labelPosition === 'below-left' ? `top:${rect.bottom + PAD}px;left:${rect.left}px;` :
											labelPosition === 'right-outside' ? `top:${rect.top + rect.height / 2}px;left:${rect.right + PAD}px;transform:translateY(-50%);` :
												labelPosition === 'left-outside' ? `top:${rect.top + rect.height / 2}px;right:${window.innerWidth - rect.left + PAD}px;transform:translateY(-50%);` :
													`top:${rect.top + PAD}px;left:${rect.left + PAD}px;`;

			const badge = document.createElement('div');
			badge.textContent = label;
			badge.dataset.screenshotAnnotation = 'label';
			badge.style.cssText = [
				'position:fixed',
				anchor,
				`background:${color}`,
				'color:#fff',
				// Fixed square so single-digit badges (1, 2, 3, ...) are
				// visually identical. Multi-character labels grow horizontally
				// via min-width + padding while the height stays uniform.
				'min-width:20px',
				'height:20px',
				'padding:0 6px',
				'box-sizing:border-box',
				'display:inline-flex',
				'align-items:center',
				'justify-content:center',
				'border-radius:3px',
				'font:600 12px system-ui,-apple-system,sans-serif',
				'white-space:nowrap',
				`z-index:${Z + 1}`,
				'pointer-events:none',
				'box-shadow:0 1px 2px rgba(0,0,0,0.15)',
			].join(';');
			document.body.appendChild(badge);
		}
	}, items);
}
