/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, decodeBase64, encodeBase64 } from '../../../../base/common/buffer.js';
import { stringHash } from '../../../../base/common/hash.js';
import { getExtensionForMimeType } from '../../../../base/common/mime.js';

/** An image data URL parsed into its MIME type and payload. */
export interface ParsedImageDataUrl {
	mimeType: string;

	/**
	 * The image payload in the form `StaticPlotClient` expects: a base64
	 * string for raster images, or the raw markup for `image/svg+xml`.
	 */
	data: string;

	/** Whether {@link data} is base64-encoded rather than text. */
	base64: boolean;
}

/**
 * Parse an image data URL into its MIME type and payload.
 *
 * Handles the encodings Positron produces for image outputs:
 * - `data:image/png;base64,...` - raster outputs
 * - `data:image/svg+xml,...` - SVG outputs from the notebook and Quarto renderers
 * - `data:image/svg+xml;utf8,...` - SVG from `StaticPlotClient.uri`
 *
 * Any other `;`-separated parameters (e.g. `;charset=utf-8`) are tolerated and
 * ignored; only a `base64` parameter changes how the payload is read.
 * @returns The parsed image, or undefined if the data URL is malformed.
 */
export function parseImageDataUrl(dataUrl: string): ParsedImageDataUrl | undefined {
	const match = /^data:(?<mimeType>[^;,]+)(?<params>;[^,]*)?,(?<payload>.*)$/s.exec(dataUrl);
	if (!match?.groups) {
		return undefined;
	}
	const { mimeType, params, payload } = match.groups;
	if (params?.split(';').includes('base64')) {
		return { mimeType, data: payload, base64: true };
	}
	let data: string;
	try {
		data = decodeURIComponent(payload);
	} catch {
		// Raw payload may contain a literal '%' that is not URL-encoded
		data = payload;
	}
	return { mimeType, data, base64: false };
}

/** An image data URL decoded into its MIME type and binary contents. */
export interface DecodedImageDataUrl {
	mimeType: string;
	data: VSBuffer;
}

/**
 * Decode an image data URL into its MIME type and binary contents, ready to
 * write to a file.
 * @returns The decoded image, or undefined if the data URL is malformed.
 */
export function decodeImageDataUrl(dataUrl: string): DecodedImageDataUrl | undefined {
	const parsed = parseImageDataUrl(dataUrl);
	if (!parsed) {
		return undefined;
	}
	if (!parsed.base64) {
		return { mimeType: parsed.mimeType, data: VSBuffer.fromString(parsed.data) };
	}
	try {
		return { mimeType: parsed.mimeType, data: decodeBase64(parsed.data) };
	} catch {
		return undefined;
	}
}

/**
 * Stable editor-tab identity for an image opened from a cell output.
 *
 * Derived from the image content and its label, so that opening the same output
 * twice resolves to the tab already open while a re-run that changes the image
 * gets a new tab. A hash collision would only focus the wrong tab, so a cheap
 * 32-bit hash is enough.
 */
export function getImagePlotId(dataUrl: string, name?: string): string {
	return `image-${stringHash(dataUrl, stringHash(name ?? '', 0))}`;
}

/** File extension (including the dot) for an image MIME type, defaulting to '.png'. */
export function getImageExtensionForMimeType(mimeType: string): string {
	return getExtensionForMimeType(mimeType) ?? '.png';
}

/**
 * Re-encode an image data URL as base64, leaving one that already is untouched.
 *
 * SVG data URLs are URL-encoded rather than base64 (`data:image/svg+xml,...`
 * from notebook and Quarto outputs, `data:image/svg+xml;utf8,...` from
 * `StaticPlotClient.uri`), but `IClipboardService.writeImage` only accepts
 * base64. A data URL that cannot be parsed is returned unchanged, so callers
 * fail in the clipboard rather than here.
 */
export function toBase64ImageDataUrl(dataUrl: string): string {
	const parsed = parseImageDataUrl(dataUrl);
	if (!parsed) {
		return dataUrl;
	}
	if (parsed.base64) {
		return dataUrl;
	}
	return `data:${parsed.mimeType};base64,${encodeBase64(VSBuffer.fromString(parsed.data))}`;
}
