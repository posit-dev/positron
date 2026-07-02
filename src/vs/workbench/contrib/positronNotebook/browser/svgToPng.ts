/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Default raster size (in CSS pixels) for SVGs that declare no usable
 * width/height or viewBox.
 */
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

/**
 * Render at 2x the SVG's declared size so text and fine detail stay legible,
 * matching common retina PNG practice.
 */
const RASTER_SCALE = 2;

/**
 * Cap on either raster dimension. Keeps a pathological SVG (e.g. declared
 * width of 100000) from exceeding Chromium's canvas limits, where drawing
 * silently fails.
 */
const MAX_RASTER_DIMENSION = 4096;

/**
 * The size an SVG should be rasterized at, in CSS pixels (before scaling).
 */
export interface SvgDimensions {
	readonly width: number;
	readonly height: number;
}

/**
 * Derives raster dimensions from an SVG document's markup.
 *
 * Uses the root element's width/height attributes when they carry resolvable
 * units (px, pt, or unitless), then falls back to the viewBox size, then to a
 * default size.
 *
 * @param svgText The SVG document source.
 * @returns The dimensions to rasterize at, or undefined when the text is not
 *   a parseable SVG document.
 */
export function parseSvgDimensions(svgText: string): SvgDimensions | undefined {
	const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
	const root = doc.documentElement;
	// eslint-disable-next-line no-restricted-syntax -- inspecting a freshly parsed XML document for DOMParser's standard parsererror element, not traversing workbench DOM
	if (doc.getElementsByTagName('parsererror').length > 0 || root.tagName.toLowerCase() !== 'svg') {
		return undefined;
	}

	const width = parseSvgLength(root.getAttribute('width'));
	const height = parseSvgLength(root.getAttribute('height'));
	if (width !== undefined && height !== undefined) {
		return { width, height };
	}

	const viewBox = root.getAttribute('viewBox');
	if (viewBox) {
		const parts = viewBox.trim().split(/[\s,]+/).map(Number);
		if (parts.length === 4 && parts.every(isFinite) && parts[2] > 0 && parts[3] > 0) {
			return { width: parts[2], height: parts[3] };
		}
	}

	return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
}

/**
 * Parses an SVG length attribute to CSS pixels. Only units with a fixed pixel
 * conversion that need no layout context are resolved (px, pt, unitless);
 * anything else (%, em, cm, ...) returns undefined so the caller falls back
 * to the viewBox.
 */
function parseSvgLength(value: string | null): number | undefined {
	if (!value) {
		return undefined;
	}
	const match = /^\s*(?<number>\d*\.?\d+)(?<unit>px|pt)?\s*$/.exec(value);
	if (!match?.groups) {
		return undefined;
	}
	let pixels = Number(match.groups.number);
	if (match.groups.unit === 'pt') {
		pixels *= 96 / 72;
	}
	return pixels > 0 ? pixels : undefined;
}

/**
 * Rasterizes an SVG document to a PNG using the renderer's native image
 * pipeline (system fonts included), drawn over a white background at 2x the
 * SVG's declared size.
 *
 * @param svgText The SVG document source.
 * @returns The PNG as a base64-encoded string, or undefined when the SVG
 *   cannot be parsed or rendered (callers should fall back to the SVG text).
 */
export async function rasterizeSvgToPng(svgText: string): Promise<string | undefined> {
	const dimensions = parseSvgDimensions(svgText);
	if (!dimensions) {
		return undefined;
	}

	try {
		const scale = Math.min(
			RASTER_SCALE,
			MAX_RASTER_DIMENSION / dimensions.width,
			MAX_RASTER_DIMENSION / dimensions.height
		);
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(dimensions.width * scale));
		canvas.height = Math.max(1, Math.round(dimensions.height * scale));

		const context = canvas.getContext('2d');
		if (!context) {
			return undefined;
		}

		const image = await loadSvgImage(svgText);

		// SVG plots frequently assume a white page background; transparent
		// pixels render unpredictably in downstream image pipelines.
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(image, 0, 0, canvas.width, canvas.height);

		const dataUrl = canvas.toDataURL('image/png');
		const base64Prefix = 'data:image/png;base64,';
		if (!dataUrl.startsWith(base64Prefix)) {
			return undefined;
		}
		const base64Data = dataUrl.substring(base64Prefix.length);
		return base64Data.length > 0 ? base64Data : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Loads an SVG document into an image element via a blob URL.
 */
function loadSvgImage(svgText: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const blob = new Blob([svgText], { type: 'image/svg+xml' });
		const url = URL.createObjectURL(blob);
		const image = new Image();
		image.onload = () => {
			URL.revokeObjectURL(url);
			resolve(image);
		};
		image.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('Failed to load SVG image'));
		};
		image.src = url;
	});
}
