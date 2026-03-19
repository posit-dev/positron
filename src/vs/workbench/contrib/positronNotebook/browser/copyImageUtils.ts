/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, encodeBase64 } from '../../../../base/common/buffer.js';

/**
 * Shape of the arg passed to `positronNotebook.cell.copyOutputImage` to target
 * a specific image output.
 */
export interface CopyImageMenuArg {
	imageDataUrl: string;
}

export function isCopyImageMenuArg(arg: unknown): arg is CopyImageMenuArg {
	return typeof arg === 'object' && arg !== null && typeof (arg as CopyImageMenuArg).imageDataUrl === 'string';
}

/**
 * Ensure a data URL uses base64 encoding. SVG data URLs from notebook outputs
 * use URL-encoding (`data:image/svg+xml,<encoded>`), but
 * `IClipboardService.writeImage` expects base64 (`data:...;base64,...`).
 */
export function toBase64DataUrl(dataUrl: string): string {
	if (dataUrl.includes(';base64,')) {
		return dataUrl;
	}
	const commaIndex = dataUrl.indexOf(',');
	if (commaIndex === -1) {
		return dataUrl;
	}
	const header = dataUrl.substring(0, commaIndex); // e.g. "data:image/svg+xml"
	const raw = dataUrl.substring(commaIndex + 1);
	let payload: string;
	try {
		payload = decodeURIComponent(raw);
	} catch {
		// Raw payload may contain literal '%' that is not URL-encoded
		payload = raw;
	}
	return `${header};base64,${encodeBase64(VSBuffer.fromString(payload))}`;
}
