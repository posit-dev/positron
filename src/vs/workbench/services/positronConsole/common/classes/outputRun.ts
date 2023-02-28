/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';

/**
 * Constants.
 */
const ESC = '\x1b';		// ESC
const CSI = ESC + '[';	// CSI

/**
 * The ANSI color map.
 */
const ansiColorMap: string[] = [
	// Regular colors.
	'ansiBlack',
	'ansiRed',
	'ansiGreen',
	'ansiYellow',
	'ansiBlue',
	'ansiMagenta',
	'ansiCyan',
	'ansiWhite',

	// Bright colors.
	'ansiBrightBlack',
	'ansiBrightRed',
	'ansiBrightGreen',
	'ansiBrightYellow',
	'ansiBrightBlue',
	'ansiBrightMagenta',
	'ansiBrightCyan',
	'ansiBrightWhite'
];

/**
 * Rounds a number to a specified number of decimal points.
 * @param number The number to round.
 * @param decimalPoints The number of decimal points to round to.
 * @returns The rounded number.
 */
const roundNumber = (number: number, decimalPoints: number): number => {
	const decimal = Math.pow(10, decimalPoints);
	return Math.round(number * decimal) / decimal;
};

/**
 * Calculate the color from the color set defined in the ANSI 8-bit standard.
 * Standard and high intensity colors are not defined in the standard as specific
 * colors, so these and invalid colors return `undefined`.
 * @see {@link https://en.wikipedia.org/wiki/ANSI_escape_code#8-bit } for info.
 * @param colorNumber The number (ranging from 16 to 255) referring to the color
 * desired.
 */
const calcANSI8bitColor = (colorNumber: number): RGBA | undefined => {
	if (colorNumber % 1 !== 0) {
		// Should be integer
		return;
	} if (colorNumber >= 16 && colorNumber <= 231) {
		// Converts to one of 216 RGB colors
		colorNumber -= 16;

		let blue: number = colorNumber % 6;
		colorNumber = (colorNumber - blue) / 6;
		let green: number = colorNumber % 6;
		colorNumber = (colorNumber - green) / 6;
		let red: number = colorNumber;

		// red, green, blue now range on [0, 5], need to map to [0,255]
		const convFactor: number = 255 / 5;
		blue = Math.round(blue * convFactor);
		green = Math.round(green * convFactor);
		red = Math.round(red * convFactor);

		return new RGBA(red, green, blue);
	} else if (colorNumber >= 232 && colorNumber <= 255) {
		// Converts to a grayscale value
		colorNumber -= 232;
		const colorLevel: number = Math.round(colorNumber / 23 * 255);
		return new RGBA(colorLevel, colorLevel, colorLevel);
	} else {
		return;
	}
};

/**
 * OutputRun interface.
 */
export interface OutputRun {
	id: string;
	foreground: string | RGBA | undefined;
	background: string | RGBA | undefined;
	text: string;
}

/**
 * Splits a text string into an OutputRun array.
 * @param value The string.
 * @returns An OutputRun array.
 */
export const outputRunSplitter = (text: string): OutputRun[] => {
	// Style state variables.
	let styleNames: string[] = [];
	let customForegroundColor: string | RGBA | undefined;
	let customBackgroundColor: string | RGBA | undefined;
	let customUnderlineColor: string | RGBA | undefined;
	let colorsInverted = false;

	// The buffer and the output runs.
	let buffer = '';
	const outputRuns: OutputRun[] = [];

	/**
	 * Changes the foreground or background color by clearing the current color
	 * and adding the new one.
	 * @param colorType If `'foreground'`, will change the foreground color, if
	 * `'background'`, will change the background color, and if `'underline'`
	 * will set the underline color.
	 * @param color Color to change to. If `undefined` or not provided, will
	 * clear current color without adding a new one.
	 */
	const changeColor = (
		colorType: 'foreground' | 'background' | 'underline',
		color: string | RGBA | undefined
	) => {
		if (colorType === 'foreground') {
			customForegroundColor = color;
		} else if (colorType === 'background') {
			customBackgroundColor = color;
		} else if (colorType === 'underline') {
			customUnderlineColor = color;
		}

		// Remove the previous style.
		styleNames = styleNames.filter(
			style => style !== `code-${colorType}-colored`
		);

		// Add the new style.
		if (color) {
			styleNames.push(`code-${colorType}-colored`);
		}
	};

	/**
	 * Swaps foreground and background colors. Used for color inversion. The
	 * caller should check [] flag to make sure it is appropriate to turn ON
	 * or OFF (if it is already inverted don't call
	 */
	const reverseForegroundAndBackgroundColors = () => {
		const oldCustomForegroundColor = customForegroundColor;
		changeColor('foreground', customBackgroundColor);
		changeColor('background', oldCustomForegroundColor);
	};

	/**
	 * Calculates and sets basic ANSI formatting. Supports ON/OFF of bold,
	 * italic, underline, double underline,  crossed-out/strikethrough,
	 * overline, dim, blink, rapid blink, reverse/invert video, hidden,
	 * superscript, subscript and alternate font codes, clearing / resetting
	 * of foreground, background and underline colors, setting normal
	 * foreground and background colors, and bright foreground and background
	 * colors. Not to be used for codes containing advanced colors. Will ignore
	 * invalid codes.
	 * @param styleCodes Array of ANSI basic styling numbers, which will be
	 * applied in order. New colors and backgrounds clear old ones; new
	 * formatting does not.
	 * @see {@link https://en.wikipedia.org/wiki/ANSI_escape_code#SGR }
	 */
	const setBasicFormatters = (styleCodes: number[]) => {
		// Enumerate the style codes.
		for (const styleCode of styleCodes) {
			// Process the style code.
			switch (styleCode) {
				// Reset (everything)
				case 0: {
					styleNames = [];
					customForegroundColor = undefined;
					customBackgroundColor = undefined;
					customUnderlineColor = undefined;
					break;
				}

				// Bold.
				case 1: {
					styleNames = styleNames.filter(style => style !== `code-bold`);
					styleNames.push('code-bold');
					break;
				}

				// Dim.
				case 2: {
					styleNames = styleNames.filter(style => style !== `code-dim`);
					styleNames.push('code-dim');
					break;
				}

				// Italic
				case 3: {
					styleNames = styleNames.filter(style => style !== `code-italic`);
					styleNames.push('code-italic');
					break;
				}

				// Underline.
				case 4: {
					styleNames = styleNames.filter(style => (style !== `code-underline` && style !== `code-double-underline`));
					styleNames.push('code-underline');
					break;
				}

				// Blink.
				case 5: {
					styleNames = styleNames.filter(style => style !== `code-blink`);
					styleNames.push('code-blink');
					break;
				}

				// Rapid blink.
				case 6: {
					styleNames = styleNames.filter(style => style !== `code-rapid-blink`);
					styleNames.push('code-rapid-blink');
					break;
				}

				// Invert foreground and background.
				case 7: { //
					if (!colorsInverted) {
						colorsInverted = true;
						reverseForegroundAndBackgroundColors();
					}
					break;
				}

				// Hidden.
				case 8: {
					styleNames = styleNames.filter(style => style !== `code-hidden`);
					styleNames.push('code-hidden');
					break;
				}

				// Strike-through / crossed-out.
				case 9: {
					styleNames = styleNames.filter(style => style !== `code-strike-through`);
					styleNames.push('code-strike-through');
					break;
				}

				// Normal default font.
				case 10: { //
					styleNames = styleNames.filter(style => !style.startsWith('code-font'));
					break;
				}

				// Font codes (and 20 is 'blackletter' font code);
				case 11:
				case 12:
				case 13:
				case 14:
				case 15:
				case 16:
				case 17:
				case 18:
				case 19:
				case 20: {
					styleNames = styleNames.filter(style => !style.startsWith('code-font'));
					styleNames.push(`code-font-${styleCode - 10}`);
					break;
				}

				// Double underline
				case 21: {
					styleNames = styleNames.filter(style => (style !== `code-underline` && style !== `code-double-underline`));
					styleNames.push('code-double-underline');
					break;
				}

				// Normal intensity (bold off and dim off).
				case 22: {
					styleNames = styleNames.filter(style => (style !== `code-bold` && style !== `code-dim`));
					break;
				}

				// Neither italic or blackletter (font 10).
				case 23: {
					styleNames = styleNames.filter(style => (style !== `code-italic` && style !== `code-font-10`));
					break;
				}

				// Not underlined (Neither singly nor doubly underlined).
				case 24: {
					styleNames = styleNames.filter(style => (style !== `code-underline` && style !== `code-double-underline`));
					break;
				}

				// Not blinking
				case 25: {
					styleNames = styleNames.filter(style => (style !== `code-blink` && style !== `code-rapid-blink`));
					break;
				}

				// Not reversed / inverted.
				case 27: {
					if (colorsInverted) {
						colorsInverted = false;
						reverseForegroundAndBackgroundColors();
					}
					break;
				}

				// Not hidden (reveal).
				case 28: {
					styleNames = styleNames.filter(style => style !== `code-hidden`);
					break;
				}

				// Not crossed-out.
				case 29: {
					styleNames = styleNames.filter(style => style !== `code-strike-through`);
					break;
				}

				// Overlined.
				case 53: {
					styleNames = styleNames.filter(style => style !== `code-overline`);
					styleNames.push('code-overline');
					break;
				}

				// Not overlined.
				case 55: {
					styleNames = styleNames.filter(style => style !== `code-overline`);
					break;
				}

				// Default foreground color.
				case 39: {
					changeColor('foreground', undefined);
					break;
				}

				// Default background color.
				case 49: {
					changeColor('background', undefined);
					break;
				}

				// Default underline color.
				case 59: {
					changeColor('underline', undefined);
					break;
				}

				// Superscript.
				case 73: {
					styleNames = styleNames.filter(style => (style !== `code-superscript` && style !== `code-subscript`));
					styleNames.push('code-superscript');
					break;
				}

				// Subscript.
				case 74: {
					styleNames = styleNames.filter(style => (style !== `code-superscript` && style !== `code-subscript`));
					styleNames.push('code-subscript');
					break;
				}

				// Neither superscript or subscript.
				case 75: {
					styleNames = styleNames.filter(style => (style !== `code-superscript` && style !== `code-subscript`));
					break;
				}

				// Default.
				default: {
					setBasicColor(styleCode);
					break;
				}
			}
		}
	};

	/**
	 * Calculate and set styling for complicated 24-bit ANSI color codes.
	 * @param styleCodes Full list of integer codes that make up the full ANSI
	 * sequence, including the two defining codes and the three RGB codes.
	 * @param colorType If `'foreground'`, will set foreground color, if
	 * `'background'`, will set background color, and if it is `'underline'`
	 * will set the underline color.
	 * @see {@link https://en.wikipedia.org/wiki/ANSI_escape_code#24-bit }
	 */
	const set24BitColor = (
		styleCodes: number[],
		colorType: 'foreground' | 'background' | 'underline'
	) => {
		if (styleCodes.length >= 5 &&
			styleCodes[2] >= 0 && styleCodes[2] <= 255 &&
			styleCodes[3] >= 0 && styleCodes[3] <= 255 &&
			styleCodes[4] >= 0 && styleCodes[4] <= 255) {
			const customColor = new RGBA(styleCodes[2], styleCodes[3], styleCodes[4]);
			changeColor(colorType, customColor);
		}
	};

	/**
	 * Calculate and set styling for advanced 8-bit ANSI color codes.
	 * @param styleCodes Full list of integer codes that make up the ANSI
	 * sequence, including the two defining codes and the one color code.
	 * @param colorType If `'foreground'`, will set foreground color, if
	 * `'background'`, will set background color and if it is `'underline'`
	 * will set the underline color.
	 * @see {@link https://en.wikipedia.org/wiki/ANSI_escape_code#8-bit }
	 */
	const set8BitColor = (
		styleCodes: number[],
		colorType: 'foreground' | 'background' | 'underline'
	) => {
		let colorNumber = styleCodes[2];
		const color = calcANSI8bitColor(colorNumber);

		if (color) {
			changeColor(colorType, color);
		} else if (colorNumber >= 0 && colorNumber <= 15) {
			if (colorType === 'underline') {
				// // for underline colors we just decode the 0-15 color number to theme color, set and return
				// const theme = themeService.getColorTheme();
				// const colorName = ansiColorIdentifiers[colorNumber];
				// const color = theme.getColor(colorName);
				// if (color) {
				// 	changeColor(colorType, color.rgba);
				// }
				return;
			}
			// Need to map to one of the four basic color ranges (30-37, 90-97, 40-47, 100-107)
			colorNumber += 30;
			if (colorNumber >= 38) {
				// Bright colors
				colorNumber += 52;
			}
			if (colorType === 'background') {
				colorNumber += 10;
			}
			setBasicColor(colorNumber);
		}
	};

	/**
	 * Calculate and set styling for basic bright and dark ANSI color codes.
	 * Uses theme colors if available. Automatically distinguishes between
	 * foreground and background colors; does not support color-clearing codes
	 * 39 and 49.
	 * @param styleCode Integer color code on one of the following ranges:
	 * [30-37, 90-97, 40-47, 100-107]. If not on one of these ranges, will do
	 * nothing.
	 */
	const setBasicColor = (styleCode: number) => {
		let colorType: 'foreground' | 'background' | undefined;
		let colorIndex: number | undefined;

		if (styleCode >= 30 && styleCode <= 37) {
			colorIndex = styleCode - 30;
			colorType = 'foreground';
		} else if (styleCode >= 90 && styleCode <= 97) {
			colorIndex = (styleCode - 90) + 8; // High-intensity (bright)
			colorType = 'foreground';
		} else if (styleCode >= 40 && styleCode <= 47) {
			colorIndex = styleCode - 40;
			colorType = 'background';
		} else if (styleCode >= 100 && styleCode <= 107) {
			colorIndex = (styleCode - 100) + 8; // High-intensity (bright)
			colorType = 'background';
		}

		if (colorIndex !== undefined && colorType) {
			const colorName = ansiColorMap[colorIndex];
			if (colorName) {
				changeColor(colorType, colorName);
			}
		}
	};

	/**
	 * Flushes the buffer.
	 */
	const flushBuffer = () => {
		if (buffer) {
			if (buffer === 'This is regular red') {
				console.log('');
			}
			outputRuns.push({
				id: generateUuid(),
				foreground: customForegroundColor,
				background: customBackgroundColor,
				text: buffer
			});
			buffer = '';
		}
	};

	// Enumerate the characters in the text.
	for (let index = 0; index < text.length;) {
		// If we encountered a CSI, it appears that we are at the start if an
		// ANSI escape sequence. Try to parse it.
		let ansiEscapeSequence = '';
		let ansiEscapeSequenceFound = false;
		if (text.startsWith(CSI, index)) {
			// Eat the CSI.
			index += CSI.length;

			// Try to parse the ANSI escape sequence. This is successful when
			// a known ANSI escape sequence terminating character is found.
			for (let i = index; i < text.length; i++) {
				// Get the character and add it to the ANSI escape sequence
				// being parsed.
				const char = text.charAt(i);
				ansiEscapeSequence += char;

				// When a known ANSI escape sequence terminating character is
				// found, set the ansiEscapeSequenceFound flag and stop parsing
				// the ANSI escape sequence
				if (char.match(/^[ABCDHIJKfhmpsu]$/)) {
					ansiEscapeSequenceFound = true;
					break;
				}
			}
		}

		// If an ANSI escape was found, process it; otherwise, buffer the char.
		if (ansiEscapeSequenceFound) {
			// Flush buffered text.
			flushBuffer();

			// Process the ANSI escape sequence.
			if (ansiEscapeSequence.match(/^(?:[34][0-8]|9[0-7]|10[0-7]|[0-9]|2[1-5,7-9]|[34]9|5[8,9]|1[0-9])(?:;[349][0-7]|10[0-7]|[013]|[245]|[34]9)?(?:;[012]?[0-9]?[0-9])*;?m$/)) {
				// Get the style codes.
				const styleCodes: number[] = ansiEscapeSequence.slice(0, -1)	// Remove final 'm' character.
					.split(';')										   			// Separate style codes.
					.filter(element => element !== '')		           			// Filter empty elements as '34;m' -> ['34', ''].
					.map(element => parseInt(element, 10));	           			// Convert to numbers.

				console.log('Style codes');
				console.log(styleCodes);

				if (styleCodes[0] === 38 || styleCodes[0] === 48 || styleCodes[0] === 58) {
					// Advanced color code - can't be combined with formatting codes like simple colors can
					// Ignores invalid colors and additional info beyond what is necessary
					const colorType = (styleCodes[0] === 38) ? 'foreground' : ((styleCodes[0] === 48) ? 'background' : 'underline');

					if (styleCodes[1] === 5) {
						set8BitColor(styleCodes, colorType);
					} else if (styleCodes[1] === 2) {
						set24BitColor(styleCodes, colorType);
					}
				} else {
					setBasicFormatters(styleCodes);
				}
			}

			// Advance the index.
			index += ansiEscapeSequence.length;
		} else {
			// Buffer the character and advance the index.
			buffer += text.charAt(index);
			index++;
		}
	}

	// Flush buffered text.
	flushBuffer();

	// Return the output runs.
	return outputRuns;
};

export class RGBA {
	_rgbaBrand: void = undefined;

	/**
	 * Red: integer in [0-255]
	 */
	readonly r: number;

	/**
	 * Green: integer in [0-255]
	 */
	readonly g: number;

	/**
	 * Blue: integer in [0-255]
	 */
	readonly b: number;

	/**
	 * Alpha: float in [0-1]
	 */
	readonly a: number;

	constructor(r: number, g: number, b: number, a: number = 1) {
		this.r = Math.min(255, Math.max(0, r)) | 0;
		this.g = Math.min(255, Math.max(0, g)) | 0;
		this.b = Math.min(255, Math.max(0, b)) | 0;
		this.a = roundNumber(Math.max(Math.min(1, a), 0), 3);
	}

	static equals(a: RGBA, b: RGBA): boolean {
		return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
	}
}
