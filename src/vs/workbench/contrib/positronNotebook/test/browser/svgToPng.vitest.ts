/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { parseSvgDimensions, rasterizeSvgToPng } from '../../browser/svgToPng.js';

describe('parseSvgDimensions', () => {
	it('uses explicit pixel width/height attributes', () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400px" height="200px"></svg>';
		expect(parseSvgDimensions(svg)).toEqual({ width: 400, height: 200 });
	});

	it('uses unitless width/height attributes', () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"></svg>';
		expect(parseSvgDimensions(svg)).toEqual({ width: 400, height: 200 });
	});

	it('converts pt width/height to pixels', () => {
		// matplotlib SVG output declares pt sizes; 1pt = 96/72 px
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="360pt" height="288pt"></svg>';
		expect(parseSvgDimensions(svg)).toEqual({ width: 480, height: 384 });
	});

	it('falls back to the viewBox when width/height are missing', () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"></svg>';
		expect(parseSvgDimensions(svg)).toEqual({ width: 640, height: 480 });
	});

	it('falls back to the viewBox for unresolvable units like percentages', () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 640 480"></svg>';
		expect(parseSvgDimensions(svg)).toEqual({ width: 640, height: 480 });
	});

	it('falls back to a default size when no dimensions are declared', () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5" /></svg>';
		expect(parseSvgDimensions(svg)).toEqual({ width: 800, height: 600 });
	});

	it('returns undefined for malformed SVG', () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"><unclosed></svg';
		expect(parseSvgDimensions(svg)).toBe(undefined);
	});

	it('returns undefined for non-SVG content', () => {
		expect(parseSvgDimensions('not svg at all')).toBe(undefined);
	});
});

describe('rasterizeSvgToPng', () => {
	it('returns undefined for malformed SVG instead of throwing', async () => {
		await expect(rasterizeSvgToPng('<svg><unclosed></svg')).resolves.toBe(undefined);
	});
});
