/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, decodeBase64, encodeBase64 } from '../../../../base/common/buffer.js';
import { numberHash, stringHash } from '../../../../base/common/hash.js';
import { getExtensionForMimeType } from '../../../../base/common/mime.js';

const DATA_URL_PREFIX = 'data:';

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
	if (!dataUrl.startsWith(DATA_URL_PREFIX)) {
		return undefined;
	}

	// Split on the first comma rather than matching the payload with a regex:
	// image data URLs run to megabytes, and a capture group over the payload
	// makes the parse cost scale with the image.
	const commaIndex = dataUrl.indexOf(',');
	if (commaIndex === -1) {
		return undefined;
	}
	const [mimeType, ...params] = dataUrl.slice(DATA_URL_PREFIX.length, commaIndex).split(';');
	if (!mimeType) {
		return undefined;
	}

	const payload = dataUrl.slice(commaIndex + 1);
	if (params.includes('base64')) {
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
 * Number of characters sampled from each end of a data URL by
 * {@link getImageContentId}.
 */
const IMAGE_CONTENT_SAMPLE_LENGTH = 1024;

/**
 * Stable id for an image data URL, derived from its content.
 *
 * Lets a caller that reopens the same image resolve to what it opened last
 * time, while content that has changed gets a new id. `key` distinguishes
 * images that may share content but not identity, e.g. the same plot in two
 * documents; pass everything that should give the image its own id.
 *
 * Two images collide only if they have the same length and agree on both
 * sampled ends. The id is a cache key rather than a checksum - a collision
 * means resolving to something equivalent, not corrupt - so a cheap 32-bit
 * hash over bounded input is enough.
 */
export function getImageContentId(dataUrl: string, key?: string): string {
	let hash = stringHash(key ?? '', 0);

	if (dataUrl.length <= IMAGE_CONTENT_SAMPLE_LENGTH * 2) {
		return `image-${stringHash(dataUrl, hash)}`;
	}

	// Sample both ends and mix in the length instead of walking the whole
	// payload: stringHash loops per character, and these run to megabytes.
	// Both ends matter - the leading bytes of two plots of the same size are
	// largely the same header, while the trailing bytes carry a checksum for
	// PNG and the closing markup for SVG.
	hash = numberHash(dataUrl.length, hash);
	hash = stringHash(dataUrl.slice(0, IMAGE_CONTENT_SAMPLE_LENGTH), hash);
	return `image-${stringHash(dataUrl.slice(-IMAGE_CONTENT_SAMPLE_LENGTH), hash)}`;
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
