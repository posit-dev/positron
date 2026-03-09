/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ANSIColor, ANSIStyle } from './ansiOutput.js';

/**
 * A map of CSS property names to their values, representing the visual style
 * for an ANSI-formatted output run.
 */
export type ANSICSSProperties = Record<string, string>;

/**
 * Computes CSS properties for an array of ANSI styles.
 * @param styles The ANSIStyle array to compute.
 * @returns An ANSICSSProperties object representing the styles.
 */
export function computeAnsiStyles(styles: ANSIStyle[]): ANSICSSProperties {
	const css: ANSICSSProperties = {};
	for (const style of styles) {
		switch (style) {
			case ANSIStyle.Bold:
				css['font-weight'] = 'bold';
				break;
			case ANSIStyle.Dim:
				css['font-weight'] = 'lighter';
				break;
			case ANSIStyle.Italic:
				css['font-style'] = 'italic';
				break;
			case ANSIStyle.Underlined:
				css['text-decoration-line'] = 'underline';
				css['text-decoration-style'] = 'solid';
				break;
			case ANSIStyle.SlowBlink:
				css['animation'] = 'positronOutputRun-blink 1s linear infinite';
				break;
			case ANSIStyle.RapidBlink:
				css['animation'] = 'positronOutputRun-blink 0.5s linear infinite';
				break;
			case ANSIStyle.Hidden:
				css['visibility'] = 'hidden';
				break;
			case ANSIStyle.CrossedOut:
				css['text-decoration-line'] = 'line-through';
				css['text-decoration-style'] = 'solid';
				break;
			case ANSIStyle.DoubleUnderlined:
				css['text-decoration-line'] = 'underline';
				css['text-decoration-style'] = 'double';
				break;
		}
	}
	return css;
}

/**
 * Resolves an ANSI color to a CSS color string.
 * @param color An ANSIColor enum value or a string (e.g., '#rrggbb').
 * @returns A CSS color string, or undefined if the color cannot be resolved.
 */
export function resolveAnsiColor(color: ANSIColor | string): string | undefined {
	switch (color) {
		case ANSIColor.Black:
		case ANSIColor.Red:
		case ANSIColor.Green:
		case ANSIColor.Yellow:
		case ANSIColor.Blue:
		case ANSIColor.Magenta:
		case ANSIColor.Cyan:
		case ANSIColor.White:
		case ANSIColor.BrightBlack:
		case ANSIColor.BrightRed:
		case ANSIColor.BrightGreen:
		case ANSIColor.BrightYellow:
		case ANSIColor.BrightBlue:
		case ANSIColor.BrightMagenta:
		case ANSIColor.BrightCyan:
		case ANSIColor.BrightWhite:
			return `var(--vscode-positronConsole-${color})`;
		default:
			// Note: ANSIColor is a string enum, so the typeof check must come
			// after the switch cases, not before.
			if (typeof color === 'string') {
				return color;
			}
			return undefined;
	}
}

/**
 * Converts an ANSICSSProperties map (with hyphenated keys) to a camelCase
 * Record suitable for use as React CSSProperties or element.style assignment.
 * @param css The ANSICSSProperties to convert.
 * @returns A Record with camelCase keys.
 */
export function ansiCSSPropertiesToCamelCase(css: ANSICSSProperties): Record<string, string> {
	const result: Record<string, string> = {};
	for (const key of Object.keys(css)) {
		const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
		result[camelKey] = css[key];
	}
	return result;
}
