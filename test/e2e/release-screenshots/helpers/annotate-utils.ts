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
	/** CSS selector that resolves to the region's element. */
	selector: string;
	/** Text shown on the label badge. */
	label: string;
	/** Border + badge color (any CSS color string). */
	color: string;
	/** Where to anchor the label badge relative to the region. Default 'top-left'. */
	labelPosition?: 'top-left' | 'top-center' | 'top-right' | 'bottom-right';
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
export async function annotate(page: Page, items: Annotation[]): Promise<void> {
	await page.evaluate((items) => {
		const BORDER_PX = 3;
		const Z = 99998;

		for (const { selector, label, color, labelPosition = 'top-left' } of items) {
			const el = document.querySelector(selector) as HTMLElement | null;
			if (!el) {
				console.warn(`[annotate] selector not found: ${selector}`);
				continue;
			}
			const rect = el.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) {
				console.warn(`[annotate] zero-size region: ${selector}`);
				continue;
			}

			// Border overlay - fixed position, sized from the rect.
			const border = document.createElement('div');
			border.dataset.screenshotAnnotation = 'border';
			border.style.cssText = [
				'position:fixed',
				`top:${rect.top}px`,
				`left:${rect.left}px`,
				`width:${rect.width}px`,
				`height:${rect.height}px`,
				`border:${BORDER_PX}px solid ${color}`,
				'box-sizing:border-box',
				'pointer-events:none',
				`z-index:${Z}`,
			].join(';');
			document.body.appendChild(border);

			// Label badge - fixed position, anchored near the chosen corner.
			// Allowed to overflow the region horizontally if the label is
			// wider than the region (e.g. 'Activity bar' inside the narrow
			// Activity bar column).
			const PAD = 6;
			const anchor =
				labelPosition === 'top-center' ? `top:${rect.top + PAD}px;left:${rect.left + rect.width / 2}px;transform:translateX(-50%);` :
					labelPosition === 'top-right' ? `top:${rect.top + PAD}px;right:${window.innerWidth - rect.right + PAD}px;` :
						labelPosition === 'bottom-right' ? `top:${rect.bottom - PAD - 24}px;right:${window.innerWidth - rect.right + PAD}px;` :
							`top:${rect.top + PAD}px;left:${rect.left + PAD}px;`;

			const badge = document.createElement('div');
			badge.textContent = label;
			badge.dataset.screenshotAnnotation = 'label';
			badge.style.cssText = [
				'position:fixed',
				anchor,
				`background:${color}`,
				'color:#fff',
				'padding:3px 8px',
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
