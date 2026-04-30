/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from '@playwright/test';

/**
 * One labeled region to annotate. The border is drawn as an inset shadow so
 * it doesn't change layout or push neighbors around. The label is positioned
 * inside the region (annotations live inside the screenshot, not outside).
 */
export type Annotation = {
	/** CSS selector that resolves to the region's element. */
	selector: string;
	/** Text shown on the label badge. */
	label: string;
	/** Border + badge color (any CSS color string). */
	color: string;
	/** Where to place the label badge inside the region. Default 'top-left'. */
	labelPosition?: 'top-left' | 'top-center' | 'top-right' | 'bottom-right';
};

/**
 * Draw inset borders and labels on the labeled regions, in the page itself,
 * so a subsequent `page.screenshot()` captures them. Mutations live until
 * navigation or app restart - which is fine for one-shot screenshot tests.
 */
export async function annotate(page: Page, items: Annotation[]): Promise<void> {
	await page.evaluate((items) => {
		for (const { selector, label, color, labelPosition = 'top-left' } of items) {
			const el = document.querySelector(selector) as HTMLElement | null;
			if (!el) {
				console.warn(`[annotate] selector not found: ${selector}`);
				continue;
			}

			// Inset box-shadow draws a border without changing the box model,
			// so nested annotations don't shift each other.
			el.style.boxShadow = `inset 0 0 0 3px ${color}`;
			if (getComputedStyle(el).position === 'static') {
				el.style.position = 'relative';
			}

			const badge = document.createElement('div');
			badge.textContent = label;
			badge.dataset.screenshotAnnotation = 'true';

			const placement =
				labelPosition === 'top-center' ? 'top:6px;left:50%;transform:translateX(-50%);' :
					labelPosition === 'top-right' ? 'top:6px;right:6px;' :
						labelPosition === 'bottom-right' ? 'bottom:6px;right:6px;' :
							'top:6px;left:6px;';

			badge.style.cssText = [
				'position:absolute',
				placement,
				`background:${color}`,
				'color:#fff',
				'padding:3px 8px',
				'border-radius:3px',
				'font:600 12px system-ui,-apple-system,sans-serif',
				'z-index:99999',
				'pointer-events:none',
				'box-shadow:0 1px 2px rgba(0,0,0,0.15)',
				// Wrap inside narrow regions (e.g. the Activity bar) so the
				// label stays inside the box-shadow border rather than
				// being clipped.
				'max-width:calc(100% - 12px)',
				'word-break:break-word',
				'white-space:normal',
				'text-align:center',
				'line-height:1.2',
			].join(';');

			el.appendChild(badge);
		}
	}, items);
}
