/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// modern-screenshot is bundled as an ESM package dependency and loaded through
// the workbench's import map (see build/npm/build-esm-package-dependencies.ts).
// eslint-disable-next-line local/code-import-patterns, local/code-amd-node-module
import { createContext, destroyContext, domToCanvas } from 'modern-screenshot';
import { VSBuffer } from '../../../../base/common/buffer.js';

/**
 * The widest screenshot to hand to a model, in pixels. Wider Viewers are
 * scaled down; a 1280x972 image is about 1,650 image tokens.
 */
const MAX_SCREENSHOT_WIDTH = 1280;

/**
 * Stands in for images that can't be re-fetched to rebuild a screenshot
 * (images from other hosts without CORS headers), so they show as a grey box
 * instead of vanishing.
 */
const PLACEHOLDER_IMAGE = 'data:image/svg+xml,' + encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="100%" height="100%" fill="#ccc"/>' +
	'<text x="50%" y="55%" font-size="11" text-anchor="middle" fill="#444" font-family="sans-serif">image</text></svg>');

/**
 * A screenshot of the Viewer's content, before it's described to agents.
 */
export interface IViewerCapture {
	readonly data: VSBuffer;
	readonly width: number;
	readonly height: number;
	readonly method: 'native' | 'dom';
}

/**
 * Draws part of an image onto white at the given size, scaled down to at most
 * MAX_SCREENSHOT_WIDTH wide, and encodes it as a PNG.
 *
 * @param source The image to draw.
 * @param crop The part of the source to draw, in the source's pixels.
 * @param width The width to draw it at, in CSS pixels.
 * @param height The height to draw it at, in CSS pixels.
 * @param targetWindow The window to create the canvas in.
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
 * Rebuilds a screenshot of what's on screen in an app's window from the page's
 * content, with modern-screenshot. Used in web builds, where the Viewer's app
 * frame is same-origin with Positron but there's no native capture. The
 * library runs in Positron's page and reads the app's document; the only thing
 * it adds to the app's page is a hidden sandbox frame while it works.
 *
 * WebGL canvases that don't keep their drawing buffer come out blank, and
 * images from other hosts without CORS headers come out as placeholders.
 * Elements with `position: fixed` move with the content when the page is
 * scrolled, so they can come out in the wrong place.
 *
 * @param appWindow The app's window.
 * @param targetWindow The window to create canvases in.
 */
export async function captureDomScreenshot(appWindow: Window, targetWindow: Window): Promise<IViewerCapture> {
	// Render just the viewport. restoreScrollPosition shifts the content of
	// every scrolled element, the page itself included, so the part of the page
	// on screen lands at the top left. (Rendering the whole page and cropping it
	// at the scroll position would shift it twice, and a long page can go over
	// the browser's canvas size limit.) Streamlit's <html> is 0 px tall, because
	// everything in it is absolutely positioned, so the size has to be given.
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
		const crop = { x: 0, y: 0, width: page.width, height: page.height };
		return { ...await encodePng(page, crop, width, height, targetWindow), method: 'dom' };
	} finally {
		destroyContext(context);
	}
}

/**
 * Converts a native capture of the Viewer (at the screen's pixel density) into
 * a screenshot at CSS pixel size, scaled down to at most MAX_SCREENSHOT_WIDTH
 * wide.
 *
 * @param png The captured PNG.
 * @param targetWindow The window the Viewer is in.
 */
export async function scaleNativeScreenshot(png: VSBuffer, targetWindow: Window): Promise<IViewerCapture> {
	const bitmap = await targetWindow.createImageBitmap(new Blob([png.buffer as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
	try {
		const ratio = targetWindow.devicePixelRatio || 1;
		const crop = { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
		return { ...await encodePng(bitmap, crop, bitmap.width / ratio, bitmap.height / ratio, targetWindow), method: 'native' };
	} finally {
		bitmap.close();
	}
}
