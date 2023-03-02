/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';

export enum SGR {
	Reset = 0,
	Bold = 1,
	Dim = 2,
	Italic = 3,
	Underlined = 4,
	SlowBlink = 5,
	RapidBlink = 6,
	Reversed = 7,
	Hidden = 8,
	CrossedOut = 9,
	PrimaryFont = 10,
	AlternativeFont1 = 11,
	AlternativeFont2 = 12,
	AlternativeFont3 = 13,
	AlternativeFont4 = 14,
	AlternativeFont5 = 15,
	AlternativeFont6 = 16,
	AlternativeFont7 = 17,
	AlternativeFont8 = 18,
	AlternativeFont9 = 19,
	Fraktur = 20,
	DoublyUnderlined = 21,
	NormalIntensity = 22,
	NotItalicNotFraktur = 23,
	NotUnderlined = 24,
	NotBlinking = 25,
	ProportionalSpacing = 26,
	NotReversed = 27,
	Reveal = 28,
	NotCrossedOut = 29,
	ForegroundBlack = 30,
	ForegroundRed = 31,
	ForegroundGreen = 32,
	ForegroundYellow = 33,
	ForegroundBlue = 34,
	ForegroundMagenta = 35,
	ForegroundCyan = 36,
	ForegroundWhite = 37,
	SetForeground = 38,
	DefaultForeground = 39,
	BackgroundBlack = 40,
	BackgroundRed = 41,
	BackgroundGreen = 42,
	BackgroundYellow = 43,
	BackgroundBlue = 44,
	BackgroundMagenta = 45,
	BackgroundCyan = 46,
	BackgroundWhite = 47,
	SetBackground = 48,
	DefaultBackground = 49,
	DisableProportionalSpacing = 50,
	Framed = 51,
	Encircled = 52,
	Overlined = 53,
	NotFramedNotEncircled = 54,
	NotOverlined = 55,
	// 56 unsupported
	// 57 unsupported
	SetUnderline = 58,
	DefaultUnderline = 59,
	IdeogramUnderlineOrRightSideLine = 60,
	IdeogramDoubleUnderlineOrDoubleRightSideLine = 61,
	IdeogramOverlineOrLeftSideLine = 62,
	IdeogramDoubleOverlineOrDoubleLeftSideLine = 63,
	IdeogramStressMarking = 64,
	NoIdeogramAttributes = 65,
	// 66 unsupported
	// 67 unsupported
	// 68 unsupported
	// 69 unsupported
	// 70 unsupported
	// 71 unsupported
	// 72 unsupported
	Superscript = 73,
	Subscript = 74,
	NotSuperscriptNotSubscript = 75,
	// 76 unsupported
	// 77 unsupported
	// 78 unsupported
	// 79 unsupported
	// 80 unsupported
	// 81 unsupported
	// 82 unsupported
	// 83 unsupported
	// 84 unsupported
	// 85 unsupported
	// 86 unsupported
	// 87 unsupported
	// 88 unsupported
	// 89 unsupported
	ForegroundGray = 90,
	BrightForegroundBlack = 90,
	BrightForegroundRed = 91,
	BrightForegroundGreen = 92,
	BrightForegroundYellow = 93,
	BrightForegroundBlue = 94,
	BrightForegroundMagenta = 95,
	BrightForegroundCyan = 96,
	BrightForegroundWhite = 97,
	// 98 unsupported
	// 99 unsupported
	BackgroundGray = 100,
	BrightBackgroundBlack = 100,
	BrightBackgroundRed = 101,
	BrightBackgroundGreen = 102,
	BrightBackgroundYellow = 103,
	BrightBackgroundBlue = 104,
	BrightBackgroundMagenta = 105,
	BrightBackgroundCyan = 106,
	BrightBackgroundWhite = 107
}

/**
 * ParserState enumeration.
 */
enum ParserState {
	Buffering,
	EscapeSequenceStarted,
	ParsingEscapeSequence
}

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

	/**
	 * Constructor.
	 * @param r The red value.
	 * @param g The green value.
	 * @param b The blue value.
	 * @param a The alpha value (defaults to 1).
	 */
	constructor(r: number, g: number, b: number, a: number = 1) {
		this.r = Math.min(255, Math.max(0, r)) | 0;
		this.g = Math.min(255, Math.max(0, g)) | 0;
		this.b = Math.min(255, Math.max(0, b)) | 0;
		this.a = roundNumber(Math.max(Math.min(1, a), 0), 3);
	}

	// Compares two RGBA instances for equality.
	static equals(a: RGBA, b: RGBA): boolean {
		return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
	}
}

/**
 * ANSIOutputLine interface.
 */
interface ANSIOutputLine {
	id: string;
	outputRuns: ANSIOutputRun[];
}

/**
 * ANSIOutputRun interface.
 */
interface ANSIOutputRun {
	/**
	 * The identifier of the run.
	 */
	readonly id: string;

	/**
	 * The styles of the run.
	 */
	readonly styles: string[];

	/**
	 * The custom foreground color.
	 */
	readonly customForegroundColor: string | RGBA | undefined;

	/**
	 * The custom background color.
	 */
	readonly customBackgroundColor: string | RGBA | undefined;

	/**
	 * The custom underlined color.
	 */
	readonly customUnderlinedColor: string | RGBA | undefined;

	/**
	 * The text of the run.
	 */
	readonly text: string;
}

/**
 * ANSIOutput class.
 */
export class ANSIOutput {
	/**
	 * Gets or sets the state.
	 */
	private state = ParserState.Buffering;

	/**
	 * Gets or sets the buffer.
	 */
	private buffer = '';

	/**
	 * Gets or sets the escape sequence.
	 */
	private escapeSequence = '';

	private styles: string[] = [];
	private customForegroundColor: string | RGBA | undefined;
	private customBackgroundColor: string | RGBA | undefined;
	private customUnderlinedColor: string | RGBA | undefined;
	private reversed = false;
	private outputLines: ANSIOutputLine[] = [];
	private currentOutputLine = 0;

	/**
	 * Constructor.
	 */
	constructor() {
	}

	/**
	 * Processes output.
	 * @param value The output value to process.
	 */
	processOutput(value: string | string[]) {
		// If the value is an array of strings, process them individually and
		// return.
		if (Array.isArray(value)) {
			return value.forEach(value => {
				this.processOutput(value);
			});
		}

		// Enumerate the characters in the value.
		for (let i = 0; i < value.length; i++) {
			// Get the character.
			const char = value.charAt(i);

			// Parse the character.
			if (this.state === ParserState.Buffering) {
				// Check for the start of an escape sequence.
				if (char === '\x1b') {
					this.state = ParserState.EscapeSequenceStarted;
				} else {
					this.processCharacter(char);
				}
			} else if (this.state === ParserState.EscapeSequenceStarted) {
				// Check for CSI.
				if (char === '[') {
					this.state = ParserState.ParsingEscapeSequence;
				} else {
					// We encountered a ESC that is not part of a CSI. Ignore
					// the ESC, go back to the Buffering state, and process the
					// character.
					this.state = ParserState.Buffering;
					this.processCharacter(char);
				}
			} else if (this.state === ParserState.ParsingEscapeSequence) {
				// Append the character to the escape sequence.
				this.escapeSequence += char;

				// If this character ends the escape sequence, process it.
				if (char.match(/^[ABCDHIJKfhmpsu]$/)) {
					this.processEscapeSequence();
				}
			}
		}
	}

	//#region Private Methods

	/**
	 * Processes a character.
	 * @param char The character.
	 */
	private processCharacter(char: string) {
		// Handle special characters.
		if (char === '\n') {
			// Flush the buffer to the current output line.
			this.flushBuffer();

			// Increment the current output line.
			this.currentOutputLine++;
		} else {
			// Buffer the character.
			this.buffer += char;
		}
	}

	/**
	 * Processes an escape sequence.
	 */
	private processEscapeSequence() {
		// Flush the current buffer.
		this.flushBuffer();

		// Process the escape sequence.
		if (this.escapeSequence.match(/^(?:[34][0-8]|9[0-7]|10[0-7]|[0-9]|2[1-5,7-9]|[34]9|5[8,9]|1[0-9])(?:;[349][0-7]|10[0-7]|[013]|[245]|[34]9)?(?:;[012]?[0-9]?[0-9])*;?m$/)) {
			// Get the style codes.
			const styleCodes: number[] = this.escapeSequence.slice(0, -1)	// Remove final 'm' character.
				.split(';')										   			// Separate style codes.
				.filter(element => element !== '')		           			// Filter empty elements as '34;m' -> ['34', ''].
				.map(element => parseInt(element, 10));	           			// Convert to numbers.

			console.log('Raw style codes from the escape sequence:');
			console.log(styleCodes);

			// Advanced color code - can't be combined with formatting codes like simple colors can
			// Ignores invalid colors and additional info beyond what is necessary.
			if (styleCodes[0] === 38 || styleCodes[0] === 48 || styleCodes[0] === 58) {
				const colorType = (styleCodes[0] === 38) ? 'foreground' : ((styleCodes[0] === 48) ? 'background' : 'underline');
				console.log(`Advanced color type ${colorType}`);
				if (styleCodes[1] === 5) {
					// set8BitColor(styleCodes, colorType);
				} else if (styleCodes[1] === 2) {
					// set24BitColor(styleCodes, colorType);
				}
			} else {
				this.setBasicFormatters(styleCodes);
			}
		}

		// Clear the escape sequence and go back to the buffering state.
		this.escapeSequence = '';
		this.state = ParserState.Buffering;
	}

	/**
	 * Flushes the buffer.
	 */
	private flushBuffer() {
		// Ensure that we have sufficient output lines.
		for (let i = this.outputLines.length; i < this.currentOutputLine + 1; i++) {
			this.outputLines.push({
				id: generateUuid(),
				outputRuns: []
			});
		}

		// If the buffer is empty, do nothing.
		if (!this.buffer) {
			return;
		}

		// Append the run to the current output line.
		this.outputLines[this.currentOutputLine].outputRuns.push({
			id: generateUuid(),
			styles: this.styles,
			customForegroundColor: this.customForegroundColor,
			customBackgroundColor: this.customBackgroundColor,
			customUnderlinedColor: this.customUnderlinedColor,
			text: this.buffer
		});

		// Clear the buffer.
		this.buffer = '';
	}

	/**
	 *
	 * @param styleCodes
	 */
	private setBasicFormatters(styleCodes: number[]) {
		// Enumerate the style codes.
		for (const styleCode of styleCodes) {
			// Process the style code.
			switch (styleCode) {
				case SGR.Reset:
					this.styles = [];
					this.customForegroundColor = undefined;
					this.customBackgroundColor = undefined;
					this.customUnderlinedColor = undefined;
					this.reversed = false;
					break;

				case SGR.Bold:
					this.styles = this.styles.filter(style => style !== 'ansi-bold');
					this.styles.push('ansi-bold');
					break;

				case SGR.Dim:
					this.styles = this.styles.filter(style => style !== 'ansi-dim');
					this.styles.push('ansi-dim');
					break;

				case SGR.Italic:
					this.styles = this.styles.filter(style => style !== 'ansi-italic');
					this.styles.push('ansi-italic');
					break;

				case SGR.Underlined:
					this.styles = this.styles.filter(style => style !== 'ansi-underline' && style !== 'ansi-double-underline');
					this.styles.push('ansi-underline');
					break;

				case SGR.SlowBlink:
					this.styles = this.styles.filter(style => style !== 'ansi-slow-blink' && style !== 'ansi-rapid-blink');
					this.styles.push('ansi-slow-blink');
					break;

				case SGR.RapidBlink:
					this.styles = this.styles.filter(style => style !== 'ansi-rapid-blink' && style !== 'ansi-slow-blink');
					this.styles.push('ansi-rapid-blink');
					break;

				case SGR.Reversed:
					if (!this.reversed) {
						this.reversed = true;
						//reverseForegroundAndBackgroundColors();
					}
					break;

				case SGR.Hidden:
					this.styles = this.styles.filter(style => style !== 'ansi-hidden');
					this.styles.push('ansi-hidden');
					break;

				case SGR.CrossedOut:
					this.styles = this.styles.filter(style => style !== 'ansi-crossed-out');
					this.styles.push('ansi-crossed-out');
					break;

				case SGR.PrimaryFont:
					this.styles = this.styles.filter(style => !style.startsWith('font'));
					break;

				// Font codes (and 20 is 'Fraktur' or 'blackletter' font code);
				case 11:
				case 12:
				case 13:
				case 14:
				case 15:
				case 16:
				case 17:
				case 18:
				case 19:
				case 20:
					this.styles = this.styles.filter(style => !style.startsWith('font'));
					this.styles.push(`font-${styleCode - 10}`);
					break;

				case SGR.DoublyUnderlined:
					this.styles = this.styles.filter(style => style !== 'double-underline' && style !== 'underline');
					this.styles.push('double-underline');
					break;

				case SGR.NormalIntensity:
					this.styles = this.styles.filter(style => style !== 'bold' && style !== 'dim');
					break;

				case SGR.NotItalicNotFraktur:
					this.styles = this.styles.filter(style => style !== 'italic' && style !== 'font-10');
					break;

				case SGR.NotUnderlined:
					this.styles = this.styles.filter(style => style !== 'underline' && style !== 'double-underline');
					break;

				case SGR.NotBlinking:
					this.styles = this.styles.filter(style => style !== 'slow-blink' && style !== 'rapid-blink');
					break;

				case SGR.NotReversed:
					if (this.reversed) {
						this.reversed = false;
						//reverseForegroundAndBackgroundColors();
					}
					break;

				case SGR.Reveal:
					this.styles = this.styles.filter(style => style !== 'hidden');
					break;

				case SGR.NotCrossedOut:
					this.styles = this.styles.filter(style => style !== 'strike-through');
					break;

				// Overlined.
				case 53:
					this.styles = this.styles.filter(style => style !== 'overline');
					this.styles.push('overline');
					break;

				// Not overlined.
				case 55:
					this.styles = this.styles.filter(style => style !== 'code-overline');
					break;

				// Default foreground color.
				case 39:
					this.changeColor('foreground', undefined);
					break;

				// Default background color.
				case 49:
					this.changeColor('background', undefined);
					break;

				// Default underlined color.
				case 59:
					this.changeColor('underlined', undefined);
					break;

				// Superscript.
				case 73:
					this.styles = this.styles.filter(style => style !== `code-superscript` && style !== `code-subscript`);
					this.styles.push('code-superscript');
					break;

				// Subscript.
				case 74:
					this.styles = this.styles.filter(style => style !== `subscript` && style !== `superscript`);
					this.styles.push('code-subscript');
					break;

				// Not superscript / not subscript.
				case 75:
					this.styles = this.styles.filter(style => style !== 'superscript' && style !== 'subscript');
					break;

				// Default.
				default:
					//setBasicColor(styleCode);
					break;
			}
		}
	}

	/**
	 * Changes a color.
	 * @param colorType
	 * @param color
	 */
	private changeColor(colorType: 'foreground' | 'background' | 'underlined', color?: RGBA | undefined) {
		switch (colorType) {
			case 'foreground':
				this.customForegroundColor = color;
				break;

			case 'background':
				this.customBackgroundColor = color;
				break;

			case 'underlined':
				this.customUnderlinedColor = color;
				break;
		}

		this.styles = this.styles.filter(style => style !== `code-${colorType}-colored`);

		if (color !== undefined) {
			this.styles.push(`code-${colorType}-colored`);
		}
	}

	//#endregion Private Methods
}
