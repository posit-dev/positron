/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import * as resvg from '@resvg/resvg-wasm';
import { log } from '../log.js';

/**
 * Scale factor for rasterized SVGs. Plot SVGs declare their size in CSS
 * pixels; rendering at 2x keeps axis labels and legends legible for vision
 * models, matching the typical resolution of retina PNG plot outputs.
 */
const RASTER_ZOOM = 2;

/**
 * Fallback font for SVG text elements (e.g. R/svglite plot axis labels).
 * The resvg WASM build cannot load system fonts, and SVG text silently
 * renders as nothing when no font is available. Liberation Sans is
 * metrically compatible with Arial/Helvetica, the families plot libraries
 * request most often. See resources/fonts/LICENSE.
 */
const FALLBACK_FONT_FAMILY = 'Liberation Sans';

/**
 * Lazily initialized rasterizer state: the wasm module is initialized at
 * most once per extension host (initWasm throws if called twice), and the
 * fallback font is loaded alongside it. Resolves to undefined when
 * initialization fails, in which case callers fall back to text handling.
 */
let initPromise: Promise<{ fontBuffers: Uint8Array[] } | undefined> | undefined;

function getExtensionPath(): string {
	const extension = vscode.extensions.getExtension('positron.positron-assistant');
	if (!extension) {
		throw new Error('positron-assistant extension not found');
	}
	return extension.extensionPath;
}

async function readWasmBinary(extensionPath: string): Promise<Uint8Array> {
	// Packaged layout: esbuild copies the wasm next to the bundle in dist/.
	// Dev/test layout: the extension runs from out/ and node_modules exists.
	const candidates = [
		path.join(extensionPath, 'dist', 'index_bg.wasm'),
		path.join(extensionPath, 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm'),
	];
	for (const candidate of candidates) {
		try {
			return await fs.readFile(candidate);
		} catch {
			// Try the next layout.
		}
	}
	throw new Error(`resvg wasm binary not found in: ${candidates.join(', ')}`);
}

async function initialize(): Promise<{ fontBuffers: Uint8Array[] } | undefined> {
	try {
		const extensionPath = getExtensionPath();
		await resvg.initWasm(await readWasmBinary(extensionPath));

		const fontBuffers: Uint8Array[] = [];
		try {
			const fontPath = path.join(extensionPath, 'resources', 'fonts', 'LiberationSans-Regular.ttf');
			fontBuffers.push(await fs.readFile(fontPath));
		} catch (error) {
			// Without a font, SVG text elements render as empty space; path
			// and shape content still renders, so proceed rather than fail.
			log.warn(`[svg rasterizer] Fallback font unavailable; SVG text may not render: ${error}`);
		}
		return { fontBuffers };
	} catch (error) {
		log.warn(`[svg rasterizer] Initialization failed; SVG outputs will be sent as text: ${error}`);
		return undefined;
	}
}

/**
 * Rasterizes an SVG document to a PNG image.
 *
 * @param svg Raw SVG source text
 * @returns PNG bytes, or undefined if the SVG could not be rendered
 *   (callers should fall back to sending the SVG source as text)
 */
export async function rasterizeSvgToPng(svg: string): Promise<Uint8Array | undefined> {
	if (!initPromise) {
		initPromise = initialize();
	}
	const state = await initPromise;
	if (!state) {
		return undefined;
	}

	try {
		const renderer = new resvg.Resvg(svg, {
			fitTo: { mode: 'zoom', value: RASTER_ZOOM },
			font: {
				fontBuffers: state.fontBuffers,
				loadSystemFonts: false,
				defaultFontFamily: FALLBACK_FONT_FAMILY,
				sansSerifFamily: FALLBACK_FONT_FAMILY,
				serifFamily: FALLBACK_FONT_FAMILY,
				monospaceFamily: FALLBACK_FONT_FAMILY,
			},
		});
		try {
			const rendered = renderer.render();
			try {
				return rendered.asPng();
			} finally {
				rendered.free();
			}
		} finally {
			renderer.free();
		}
	} catch (error) {
		log.warn(`[svg rasterizer] Failed to rasterize SVG output: ${error}`);
		return undefined;
	}
}
