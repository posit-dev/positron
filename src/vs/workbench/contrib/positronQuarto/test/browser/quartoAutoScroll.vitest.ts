/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { computeAutoScrollTop, QuartoAutoScrollLayout } from '../../browser/quartoOutputManager.js';

// computeAutoScrollTop decides how far the editor must scroll to reveal an
// output view zone. Output appears at the bottom of the zone, so it keeps the
// bottom of the zone at the bottom of the viewport (tailing a zone taller than
// the editor), and scrolls the minimum necessary: a zone whose bottom is
// already visible is left alone. All offsets are in the editor's scroll-content
// coordinate space (0 = top of content).
describe('computeAutoScrollTop', () => {
	// A viewport 100px tall over 1000px of content, scrolled to the top.
	function layout(overrides: Partial<QuartoAutoScrollLayout>): QuartoAutoScrollLayout {
		return {
			zoneTop: 0,
			zoneBottom: 0,
			scrollTop: 0,
			viewportHeight: 100,
			scrollHeight: 1000,
			...overrides,
		};
	}

	it('does not scroll when the zone bottom is already visible', () => {
		// Zone occupies 40-80 within the visible 0-100 window.
		expect(computeAutoScrollTop(layout({ zoneTop: 40, zoneBottom: 80 }))).toBeUndefined();
	});

	it('does not scroll while a tall zone is already tailing', () => {
		// Zone 200-500 with its bottom (500) pinned at the viewport bottom.
		expect(computeAutoScrollTop(layout({ zoneTop: 200, zoneBottom: 500, scrollTop: 400 })))
			.toBeUndefined();
	});

	it('scrolls down to pin the zone bottom to the viewport bottom', () => {
		// Zone 200-260 (fits) sits below the visible 0-100 window.
		expect(computeAutoScrollTop(layout({ zoneTop: 200, zoneBottom: 260 })))
			.toBe(160); // zoneBottom - viewportHeight
	});

	it('scrolls up to bring the bottom of a zone above the viewport into view', () => {
		// Zone 250-290 sits entirely above the visible 500-600 window.
		expect(computeAutoScrollTop(layout({ zoneTop: 250, zoneBottom: 290, scrollTop: 500 })))
			.toBe(190); // zoneBottom - viewportHeight
	});

	it('tails a zone taller than the viewport, showing its most recent output', () => {
		// Zone 200-500 (300px) is taller than the 100px viewport: keep the
		// bottom (newest output) in view rather than its start.
		expect(computeAutoScrollTop(layout({ zoneTop: 200, zoneBottom: 500 })))
			.toBe(400); // zoneBottom - viewportHeight
	});

	it('clamps the target to the maximum scroll position', () => {
		// Revealing the zone bottom would require scrollTop 950, but content is
		// only 1000px over a 100px viewport, so the max scrollTop is 900.
		expect(computeAutoScrollTop(layout({ zoneTop: 980, zoneBottom: 1050, scrollHeight: 1000 })))
			.toBe(900);
	});

	it('returns undefined when the zone has no laid-out height', () => {
		expect(computeAutoScrollTop(layout({ zoneTop: 200, zoneBottom: 200 }))).toBeUndefined();
	});

	it('returns undefined when there is no viewport height', () => {
		expect(computeAutoScrollTop(layout({ zoneTop: 200, zoneBottom: 260, viewportHeight: 0 }))).toBeUndefined();
	});

	it('ignores sub-pixel adjustments', () => {
		// The zone bottom is 0.5px below the viewport bottom: not worth a scroll.
		expect(computeAutoScrollTop(layout({ zoneTop: 60, zoneBottom: 100.5 }))).toBeUndefined();
	});
});
