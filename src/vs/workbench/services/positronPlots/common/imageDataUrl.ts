/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, decodeBase64 } from '../../../../base/common/buffer.js';
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
 * Handles both base64 data URLs (raster images) and URL-encoded data URLs
 * (SVG, as produced by the notebook and Quarto output renderers).
 * @returns The parsed image, or undefined if the data URL is malformed.
 */
export function parseImageDataUrl(dataUrl: string): ParsedImageDataUrl | undefined {
	const match = /^data:(?<mimeType>[^;,]+)(?<base64>;base64)?,(?<payload>.*)$/s.exec(dataUrl);
	if (!match?.groups) {
		return undefined;
	}
	const { mimeType, base64, payload } = match.groups;
	if (base64) {
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

/** File extension (including the dot) for an image MIME type, defaulting to '.png'. */
export function getImageExtensionForMimeType(mimeType: string): string {
	return getExtensionForMimeType(mimeType) ?? '.png';
}
