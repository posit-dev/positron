/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { nativeImage, NativeImage } from 'electron';

/**
 * Converts an RGB color to HSL.
 * @returns [h, s, l] where h is in [0, 360), s and l are in [0, 1].
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;

	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;

	if (max === min) {
		return [0, 0, l]; // achromatic
	}

	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

	let h: number;
	if (max === rn) {
		h = (gn - bn) / d + (gn < bn ? 6 : 0);
	} else if (max === gn) {
		h = (bn - rn) / d + 2;
	} else {
		h = (rn - gn) / d + 4;
	}
	h *= 60;

	return [h, s, l];
}

/**
 * Converts an HSL color to RGB.
 * @param h Hue in [0, 360).
 * @param s Saturation in [0, 1].
 * @param l Lightness in [0, 1].
 * @returns [r, g, b] each in [0, 255].
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	if (s === 0) {
		const v = Math.round(l * 255);
		return [v, v, v]; // achromatic
	}

	const hue2rgb = (p: number, q: number, t: number): number => {
		if (t < 0) { t += 1; }
		if (t > 1) { t -= 1; }
		if (t < 1 / 6) { return p + (q - p) * 6 * t; }
		if (t < 1 / 2) { return q; }
		if (t < 2 / 3) { return p + (q - p) * (2 / 3 - t) * 6; }
		return p;
	};

	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const hn = h / 360;

	const r = Math.round(hue2rgb(p, q, hn + 1 / 3) * 255);
	const g = Math.round(hue2rgb(p, q, hn) * 255);
	const b = Math.round(hue2rgb(p, q, hn - 1 / 3) * 255);

	return [r, g, b];
}

/**
 * Parses a hex color string like "#RRGGBB" into [r, g, b] components in [0, 255].
 * Returns undefined if the string is not a valid 6-digit hex color.
 */
function parseHexColor(hex: string): [number, number, number] | undefined {
	const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
	if (!match) {
		return undefined;
	}
	const n = parseInt(match[1], 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Recolors the background of the Positron dev icon to the specified hex color.
 *
 * The icon is expected to be a white "P" logo on a solid colored background (e.g., green).
 * This function identifies background pixels by their saturation and hue, and remaps their
 * hue and saturation to the target color while preserving the original lightness. This
 * preserves anti-aliasing, rounded corner blending, and subtle shadow variations.
 *
 * Falls back to the original unmodified icon if the hex color is invalid or if any error
 * occurs during image manipulation.
 *
 * @param iconPath Absolute path to the source PNG icon file.
 * @param hexColor Target background color as a 6-digit hex string, e.g. "#FF5733".
 * @returns A NativeImage with the background recolored, or the original image on failure.
 */
export function recolorDevIcon(iconPath: string, hexColor: string): NativeImage {
	const original = nativeImage.createFromPath(iconPath);

	if (original.isEmpty()) {
		return original;
	}

	const targetRgb = parseHexColor(hexColor);
	if (!targetRgb) {
		return original;
	}

	const [targetH, targetS] = rgbToHsl(...targetRgb);

	const size = original.getSize();
	const { width, height } = size;

	// toBitmap() returns raw pixel data in BGRA order (4 bytes per pixel).
	const bitmap = original.toBitmap();
	const expectedLength = width * height * 4;
	if (bitmap.length !== expectedLength) {
		// Unexpected format; bail out safely.
		return original;
	}

	const output = Buffer.from(bitmap); // copy so we can mutate

	for (let i = 0; i < output.length; i += 4) {
		const b = output[i];
		const g = output[i + 1];
		const r = output[i + 2];
		const a = output[i + 3];

		// Skip fully transparent pixels (rounded corners, outside the icon boundary).
		if (a === 0) {
			continue;
		}

		const [_h, s, l] = rgbToHsl(r, g, b);

		// Identify background pixels: must be sufficiently saturated (not white/gray/black).
		// The white "P" foreground has s ~= 0, so this naturally skips it.
		// Threshold of 0.15 handles anti-aliased edges between white and the background.
		if (s < 0.15) {
			continue;
		}

		// Remap hue and saturation to the target color, preserve lightness.
		// This retains any subtle lightness variations (shadows, gradients, anti-aliasing).
		const [nr, ng, nb] = hslToRgb(targetH, targetS, l);

		// Write back in BGRA order.
		output[i] = nb;
		output[i + 1] = ng;
		output[i + 2] = nr;
		output[i + 3] = a;
	}

	return nativeImage.createFromBitmap(output, { width, height });
}
