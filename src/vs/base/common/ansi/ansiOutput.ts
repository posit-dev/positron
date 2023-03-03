/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { ANSIColor, ANSIFont, ANSIStyle } from 'vs/base/common/ansi/ansiDefinitions';

/**
 * SGRParam enumeration.
 */
enum SGRParam {
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
	DoubleUnderlined = 21,
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
	ForegroundBrightBlack = 90,
	ForegroundBrightRed = 91,
	ForegroundBrightGreen = 92,
	ForegroundBrightYellow = 93,
	ForegroundBrightBlue = 94,
	ForegroundBrightMagenta = 95,
	ForegroundBrightCyan = 96,
	ForegroundBrightWhite = 97,
	// 98 unsupported
	// 99 unsupported
	BackgroundBrightBlack = 100,
	BackgroundBrightRed = 101,
	BackgroundBrightGreen = 102,
	BackgroundBrightYellow = 103,
	BackgroundBrightBlue = 104,
	BackgroundBrightMagenta = 105,
	BackgroundBrightCyan = 106,
	BackgroundBrightWhite = 107
}

/**
 * ParserState enumeration.
 */
enum ParserState {
	BufferingOutput,
	ControlSequenceStarted,
	ParsingControlSequence
}

/**
 * SGRState class.
 */
class SGRState {
	//#region Private Properties.

	/**
	 * Gets or sets the SGR styles.
	 */
	private _styles: ANSIStyle[] = [];

	/**
	 * Gets or sets the foreground color.
	 */
	private _foregroundColor?: ANSIColor | string = undefined;

	/**
	 * Gets or sets the background color.
	 */
	private _backgroundColor?: ANSIColor | string = undefined;

	/**
	 * Gets or sets the underlined color.
	 */
	private _underlinedColor?: string = undefined;

	/**
	 * Gets or sets a value which indicates whether the foreground and
	 * background colors are reversed.
	 */
	private _reversed = false;

	/**
	 * Gets or sets the font.
	 */
	private _font?: ANSIFont = undefined;

	//#endregion Private Properties.

	//#region Public Methods

	/**
	 * Resets the SGRState.
	 */
	reset() {
		this._styles = [];
		this._foregroundColor = undefined;
		this._backgroundColor = undefined;
		this._underlinedColor = undefined;
		this._reversed = false;
		this._font = undefined;
	}

	/**
	 * Sets a style.
	 * @param style The style to set.
	 * @param stylesToClear The styles to clear.
	 */
	setStyle(style: ANSIStyle, ...stylesToClear: ANSIStyle[]) {
		// Clear styles.
		this.clearStyles(style, ...stylesToClear);

		// Set the style.
		this._styles.push(style);
	}

	/**
	 * Clears styles.
	 * @param stylesToClear The styles to clear.
	 */
	clearStyles(...stylesToClear: ANSIStyle[]) {
		this._styles = this._styles.filter(sgrStyle => !stylesToClear.includes(sgrStyle));
	}

	/**
	 * Sets the foreground color.
	 */
	setForegroundColor(sgrColor?: ANSIColor | string) {
		if (!this._reversed) {
			this._foregroundColor = sgrColor;
		} else {
			this._backgroundColor = sgrColor;
		}
	}

	/**
	 * Sets the background color.
	 */
	setBackgroundColor(sgrColor?: ANSIColor | string) {
		if (!this._reversed) {
			this._backgroundColor = sgrColor;
		} else {
			this._foregroundColor = sgrColor;
		}
	}

	/**
	 * Sets reversed.
	 */
	setReversed(reversed: boolean) {
		if (this._reversed !== reversed) {
			this._reversed = reversed;
			this.reverseForegroundAndBackgroundColors();
		}
	}

	copy(): SGRState {
		const copy = new SGRState();
		copy._styles = [...this._styles];
		copy._foregroundColor = this._foregroundColor;
		copy._backgroundColor = this._backgroundColor;
		copy._underlinedColor = this._underlinedColor;
		copy._reversed = this._reversed;
		copy._font = this._font;
		return copy;
	}

	/**
	 * Determines whether two SGRState objects are equal.
	 * @param a SGRState a.
	 * @param b SGRState b.
	 * @returns true, if the SGRState objects are equal; otherwise, false.
	 */
	static equals(a: SGRState, b: SGRState): boolean {
		// Compare styles length.
		if (a._styles.length !== b._styles.length) {
			return false;
		}

		// Compare styles.
		for (let i = 0; i < a._styles.length; i++) {
			if (a._styles[i] !== b._styles[i]) {
				return false;
			}
		}

		// Compare colors and font.
		return a._foregroundColor === b._foregroundColor &&
			a._backgroundColor === b._backgroundColor &&
			a._underlinedColor === b._underlinedColor &&
			a._reversed === b._reversed &&
			a._font === b._font;
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Reverses the foreground and background colors.
	 */
	private reverseForegroundAndBackgroundColors() {
		const foregroundColor = this._foregroundColor;
		this._foregroundColor = this._backgroundColor;
		this._backgroundColor = foregroundColor;
	}

	//#endregion Private Methods
}

/**
 * ANSIOutput class.
 */
export class ANSIOutput {
	//#region Private Properties

	/**
	 * Gets or sets the parser state.
	 */
	private parserState = ParserState.BufferingOutput;

	/**
	 * Gets or sets the buffer.
	 */
	private buffer = '';

	/**
	 * Gets or sets the control sequence that's being parsed.
	 */
	private controlSequence = '';

	/**
	 * Gets or sets the SGR state.
	 */
	private sgrState = new SGRState();

	/**
	 * The current set of output lines.
	 */
	private outputLines: ANSIOutputLine[] = [];

	/**
	 * Gets the current output line.
	 */
	private currentOutputLine = 0;

	//#endregion Private Properties

	//#region Public Methods

	/**
	 * Processes output.
	 * @param output The output value to process.
	 */
	processOutput(...output: string[]) {
		output.forEach(output => this.doProcessOutput(output));
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Processes output.
	 * @param output The output to process.
	 */
	private doProcessOutput(output: string) {
		// Enumerate the characters in the output.
		for (let i = 0; i < output.length; i++) {
			// Get the character.
			const char = output.charAt(i);

			// Parse the character.
			if (this.parserState === ParserState.BufferingOutput) {
				// Check for the start of an control sequence.
				if (char === '\x1b') {
					this.parserState = ParserState.ControlSequenceStarted;
				} else {
					this.processCharacter(char);
				}
			} else if (this.parserState === ParserState.ControlSequenceStarted) {
				// Check for CSI.
				if (char === '[') {
					this.parserState = ParserState.ParsingControlSequence;
				} else {
					// We encountered an ESC that is not part of a CSI. Ignore
					// the ESC, go back to the buffering output state, and
					// process the character.
					this.parserState = ParserState.BufferingOutput;
					this.processCharacter(char);
				}
			} else if (this.parserState === ParserState.ParsingControlSequence) {
				// Append the character to the control sequence.
				this.controlSequence += char;

				// If this character ends the control sequence, process it.
				if (char.match(/^[A-Za-z]$/)) {
					this.processControlSequence();
				}
			}
		}
	}

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
	 * Processes a control sequence.
	 */
	private processControlSequence() {
		// Process SGR control sequence.
		if (this.controlSequence.endsWith('m')) {
			this.processSGRControlSequence();
		} else {
			console.log(`Ignoring control sequence: CSI${this.controlSequence}`);
		}

		// Clear the control sequence and go back to the buffering output state.
		this.controlSequence = '';
		this.parserState = ParserState.BufferingOutput;
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
			styles: [],//this.styles,
			customForegroundColor: '', // this.sgrState.customForegroundColor,
			customBackgroundColor: '', // this.sgrState.customBackgroundColor,
			customUnderlinedColor: '', // this.sgrState.underlinedColor,
			text: this.buffer
		});

		// Clear the buffer.
		this.buffer = '';
	}

	/**
	 * Processes an SGR control sequence.
	 */
	private processSGRControlSequence() {
		// Log.
		console.log(`Processing control sequence SGR: CSI${this.controlSequence}`);

		// Parse the SGR parameters.
		const sgrParams = this.controlSequence
			// Remove ending m.
			.slice(0, -1)
			// Split the SGR parameters.
			.split(';')
			// Parse the parameter. An empty parameter is a reset. For example,
			// ESC[31;m does not produce read output.
			.map(sgrParam => sgrParam === '' ? SGRParam.Reset : parseInt(sgrParam, 10));

		// Process the SGR parameters.
		for (let i = 0; i < sgrParams.length; i++) {
			// Get the SGR parameter.
			const sgrParam = sgrParams[i];

			// Process the SGR parameter.
			switch (sgrParam) {
				case SGRParam.Reset:
					this.sgrState.reset();
					break;

				case SGRParam.Bold:
					this.sgrState.setStyle(ANSIStyle.Bold);
					break;

				case SGRParam.Dim:
					this.sgrState.setStyle(ANSIStyle.Dim);
					break;

				case SGRParam.Italic:
					this.sgrState.setStyle(ANSIStyle.Italic);
					break;

				case SGRParam.Underlined:
					this.sgrState.setStyle(ANSIStyle.Underlined, ANSIStyle.DoubleUnderlined);
					break;

				case SGRParam.SlowBlink:
					this.sgrState.setStyle(ANSIStyle.SlowBlink, ANSIStyle.RapidBlink);
					break;

				case SGRParam.RapidBlink:
					this.sgrState.setStyle(ANSIStyle.RapidBlink, ANSIStyle.SlowBlink);
					break;

				case SGRParam.Reversed:
					this.sgrState.setReversed(true);
					break;

				case SGRParam.Hidden:
					this.sgrState.setStyle(ANSIStyle.Hidden);
					break;

				case SGRParam.CrossedOut:
					this.sgrState.setStyle(ANSIStyle.CrossedOut);
					break;

				case SGRParam.PrimaryFont:
				case SGRParam.AlternativeFont1:
				case SGRParam.AlternativeFont2:
				case SGRParam.AlternativeFont3:
				case SGRParam.AlternativeFont4:
				case SGRParam.AlternativeFont5:
				case SGRParam.AlternativeFont6:
				case SGRParam.AlternativeFont7:
				case SGRParam.AlternativeFont8:
				case SGRParam.AlternativeFont9:
					break;

				case SGRParam.Fraktur:
					this.sgrState.setStyle(ANSIStyle.Fraktur);
					break;

				case SGRParam.DoubleUnderlined:
					this.sgrState.setStyle(ANSIStyle.DoubleUnderlined, ANSIStyle.Underlined);
					break;

				case SGRParam.NormalIntensity:
					this.sgrState.clearStyles(ANSIStyle.Bold, ANSIStyle.Dim);
					break;

				case SGRParam.NotItalicNotFraktur:
					this.sgrState.clearStyles(ANSIStyle.Italic, ANSIStyle.Fraktur);
					break;

				case SGRParam.NotUnderlined:
					this.sgrState.clearStyles(ANSIStyle.Underlined, ANSIStyle.DoubleUnderlined);
					break;

				case SGRParam.NotBlinking:
					this.sgrState.clearStyles(ANSIStyle.SlowBlink, ANSIStyle.RapidBlink);
					break;

				case SGRParam.ProportionalSpacing:
					// Do nothing.
					break;

				case SGRParam.NotReversed:
					this.sgrState.setReversed(false);
					break;

				case SGRParam.Reveal:
					this.sgrState.clearStyles(ANSIStyle.Hidden);
					break;

				case SGRParam.NotCrossedOut:
					this.sgrState.clearStyles(ANSIStyle.CrossedOut);
					break;

				case SGRParam.ForegroundBlack:
					this.sgrState.setForegroundColor(ANSIColor.Black);
					break;

				case SGRParam.ForegroundRed:
					this.sgrState.setForegroundColor(ANSIColor.Red);
					break;

				case SGRParam.ForegroundGreen:
					this.sgrState.setForegroundColor(ANSIColor.Green);
					break;

				case SGRParam.ForegroundYellow:
					this.sgrState.setForegroundColor(ANSIColor.Yellow);
					break;

				case SGRParam.ForegroundBlue:
					this.sgrState.setForegroundColor(ANSIColor.Blue);
					break;

				case SGRParam.ForegroundMagenta:
					this.sgrState.setForegroundColor(ANSIColor.Magenta);
					break;

				case SGRParam.ForegroundCyan:
					this.sgrState.setForegroundColor(ANSIColor.Cyan);
					break;

				case SGRParam.ForegroundWhite:
					this.sgrState.setForegroundColor(ANSIColor.White);
					break;

				case SGRParam.SetForeground:
					// Get the 3 bit or 24 bit color.
					break;

				case SGRParam.DefaultForeground:
					this.sgrState.setForegroundColor();
					break;

				case SGRParam.BackgroundBlack:
					this.sgrState.setBackgroundColor(ANSIColor.Black);
					break;

				case SGRParam.BackgroundRed:
					this.sgrState.setBackgroundColor(ANSIColor.Red);
					break;

				case SGRParam.BackgroundGreen:
					this.sgrState.setBackgroundColor(ANSIColor.Green);
					break;

				case SGRParam.BackgroundYellow:
					this.sgrState.setBackgroundColor(ANSIColor.Yellow);
					break;

				case SGRParam.BackgroundBlue:
					this.sgrState.setBackgroundColor(ANSIColor.Blue);
					break;

				case SGRParam.BackgroundMagenta:
					this.sgrState.setBackgroundColor(ANSIColor.Magenta);
					break;

				case SGRParam.BackgroundCyan:
					this.sgrState.setBackgroundColor(ANSIColor.Cyan);
					break;

				case SGRParam.BackgroundWhite:
					this.sgrState.setBackgroundColor(ANSIColor.White);
					break;

				case SGRParam.ForegroundBrightBlack:
					this.sgrState.setForegroundColor(ANSIColor.BrightBlack);
					break;

				case SGRParam.ForegroundBrightRed:
					this.sgrState.setForegroundColor(ANSIColor.BrightRed);
					break;

				case SGRParam.ForegroundBrightGreen:
					this.sgrState.setForegroundColor(ANSIColor.BrightGreen);
					break;

				case SGRParam.ForegroundBrightYellow:
					this.sgrState.setForegroundColor(ANSIColor.BrightYellow);
					break;

				case SGRParam.ForegroundBrightBlue:
					this.sgrState.setForegroundColor(ANSIColor.BrightBlue);
					break;

				case SGRParam.ForegroundBrightMagenta:
					this.sgrState.setForegroundColor(ANSIColor.BrightMagenta);
					break;

				case SGRParam.ForegroundBrightCyan:
					this.sgrState.setForegroundColor(ANSIColor.BrightCyan);
					break;

				case SGRParam.ForegroundBrightWhite:
					this.sgrState.setForegroundColor(ANSIColor.BrightWhite);
					break;

				case SGRParam.BackgroundBrightBlack:
					this.sgrState.setBackgroundColor(ANSIColor.BrightBlack);
					break;

				case SGRParam.BackgroundBrightRed:
					this.sgrState.setBackgroundColor(ANSIColor.BrightRed);
					break;

				case SGRParam.BackgroundBrightGreen:
					this.sgrState.setBackgroundColor(ANSIColor.BrightGreen);
					break;

				case SGRParam.BackgroundBrightYellow:
					this.sgrState.setBackgroundColor(ANSIColor.BrightYellow);
					break;

				case SGRParam.BackgroundBrightBlue:
					this.sgrState.setBackgroundColor(ANSIColor.BrightBlue);
					break;

				case SGRParam.BackgroundBrightMagenta:
					this.sgrState.setBackgroundColor(ANSIColor.BrightMagenta);
					break;

				case SGRParam.BackgroundBrightCyan:
					this.sgrState.setBackgroundColor(ANSIColor.BrightCyan);
					break;

				case SGRParam.BackgroundBrightWhite:
					this.sgrState.setBackgroundColor(ANSIColor.BrightWhite);
					break;
			}
		}
	}

	//#endregion Private Methods
}
