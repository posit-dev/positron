/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import type { IViewerRect } from '../common/positronViewerAgent.js';

/**
 * The widest screenshot to hand to a model, in pixels. Wider Viewers are
 * scaled down; a 1280x972 image is about 1,650 image tokens.
 */
const MAX_SCREENSHOT_WIDTH = 1280;

/**
 * Stands in for images that can't be re-fetched (from other hosts without CORS
 * headers), so they show as a grey box instead of vanishing.
 */
const PLACEHOLDER_IMAGE = 'data:image/svg+xml,' + encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="100%" height="100%" fill="#ccc"/>' +
	'<text x="50%" y="55%" font-size="11" text-anchor="middle" fill="#444" font-family="sans-serif">image</text></svg>');

/**
 * A screenshot as the webview takes it. The service adds the rest of
 * IViewerScreenshot.
 */
export interface IViewerCapture {
	readonly data: VSBuffer;
	readonly width: number;
	readonly height: number;
	readonly method: 'native' | 'dom';
}

/**
 * The part of a capture to keep: `rect`, in CSS pixels, clipped to the
 * capture, in the capture's pixels. Throws if none of it is in the capture.
 *
 * @param scale The capture's pixels per CSS pixel.
 */
function cropOf(rect: IViewerRect | undefined, width: number, height: number, scale: number): { x: number; y: number; width: number; height: number } {
	if (!rect) {
		return { x: 0, y: 0, width, height };
	}
	const left = Math.max(0, Math.round(rect.x * scale));
	const top = Math.max(0, Math.round(rect.y * scale));
	const right = Math.min(width, Math.round((rect.x + rect.width) * scale));
	const bottom = Math.min(height, Math.round((rect.y + rect.height) * scale));
	if (right <= left || bottom <= top) {
		throw new Error('The element isn\'t in the visible part of the page. Scroll it into view first.');
	}
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Draws part of an image onto white at the given size, scaled down to at most
 * MAX_SCREENSHOT_WIDTH wide, and encodes it as a PNG.
 *
 * @param crop The part of the source to draw, in the source's pixels.
 * @param width The width to draw it at, in CSS pixels.
 * @param height The height to draw it at, in CSS pixels.
 */
async function encodePng(
	source: CanvasImageSource,
	crop: { x: number; y: number; width: number; height: number },
	width: number,
	height: number,
	targetWindow: Window,
): Promise<{ data: VSBuffer; width: number; height: number }> {
	const scale = Math.min(1, MAX_SCREENSHOT_WIDTH / width);
	const canvas = targetWindow.document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(width * scale));
	canvas.height = Math.max(1, Math.round(height * scale));
	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('Could not create a canvas to draw the screenshot.');
	}
	context.fillStyle = '#fff';
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
	const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
	if (!blob) {
		throw new Error('Could not encode the screenshot.');
	}
	return {
		data: VSBuffer.wrap(new Uint8Array(await blob.arrayBuffer())),
		width: canvas.width,
		height: canvas.height,
	};
}

/**
 * Rebuilds a screenshot of what's on screen in an app's window from its DOM,
 * for web builds, which have no native capture. modern-screenshot runs in
 * Positron's page; all it adds to the app's page is a hidden sandbox frame
 * while it works.
 *
 * WebGL canvases that don't keep their drawing buffer come out blank, images
 * from other hosts without CORS headers come out as placeholders, and
 * `position: fixed` elements can be misplaced when the page is scrolled.
 *
 * @param targetWindow The window to create canvases in.
 * @param rect The part of the viewport to keep, in CSS pixels.
 */
export async function captureDomScreenshot(appWindow: Window, targetWindow: Window, rect?: IViewerRect): Promise<IViewerCapture> {
	// modern-screenshot is an ESM package dependency, resolved through the
	// workbench's import map (see build/npm/build-esm-package-dependencies.ts).
	// It's imported here, on first use, so Desktop, which takes native
	// screenshots, never loads it.
	// eslint-disable-next-line local/code-amd-node-module
	const { createContext, destroyContext, domToCanvas } = await import('modern-screenshot');

	// Render just the viewport: restoreScrollPosition shifts every scrolled
	// element's content, the page's too, so what's on screen lands at the top
	// left (cropping a whole-page render at the scroll position would shift it
	// twice). Give the size, because Streamlit's <html> is 0 px tall.
	const width = appWindow.innerWidth;
	const height = appWindow.innerHeight;
	// Make the context here rather than letting domToCanvas make one, so that
	// the sandbox frame is removed from the app's page even if the capture fails.
	const context = await createContext(appWindow.document.documentElement, {
		scale: 1,
		width,
		height,
		timeout: 10_000,
		fetch: { placeholderImage: PLACEHOLDER_IMAGE },
		// Also keeps the scroll positions of scrolling areas inside the page
		// (Streamlit scrolls an inner element, not the window).
		features: { restoreScrollPosition: true },
		// No backgroundColor: it paints over the page's own background. The
		// image goes onto white in encodePng instead.
	});
	try {
		const page = await domToCanvas(context);
		const crop = cropOf(rect, page.width, page.height, page.width / width);
		return { ...await encodePng(page, crop, crop.width * width / page.width, crop.height * height / page.height, targetWindow), method: 'dom' };
	} finally {
		destroyContext(context);
	}
}

/**
 * Converts a native capture of the Viewer (at the screen's pixel density) into
 * a screenshot at CSS pixel size, scaled down to at most MAX_SCREENSHOT_WIDTH
 * wide.
 *
 * @param targetWindow The window the Viewer is in.
 * @param rect The part of the viewport to keep, in CSS pixels.
 */
export async function scaleNativeScreenshot(png: VSBuffer, targetWindow: Window, rect?: IViewerRect): Promise<IViewerCapture> {
	const bitmap = await targetWindow.createImageBitmap(new Blob([png.buffer as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
	try {
		const ratio = targetWindow.devicePixelRatio || 1;
		const crop = cropOf(rect, bitmap.width, bitmap.height, ratio);
		return { ...await encodePng(bitmap, crop, crop.width / ratio, crop.height / ratio, targetWindow), method: 'native' };
	} finally {
		bitmap.close();
	}
}
