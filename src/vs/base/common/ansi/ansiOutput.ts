/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

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
	 * Gets or sets the styles.
	 */
	private _styles = new Set<ANSIStyle>();

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
	 * Creates an output run.
	 * @param text
	 */
	createOutputRun(text: string): ANSIOutputRun {
		return {
			id: crypto.randomUUID(),
			styles: [...this._styles],
			foregroundColor: this._foregroundColor,
			backgroundColor: this._backgroundColor,
			underlinedColor: this._underlinedColor,
			font: this._font,
			text,
		};
	}

	/**
	 * Resets the SGRState.
	 */
	reset() {
		this._styles = new Set<ANSIStyle>();
		this._foregroundColor = undefined;
		this._backgroundColor = undefined;
		this._underlinedColor = undefined;
		this._reversed = false;
		this._font = undefined;
	}

	/**
	 * Sets a style.
	 * @param style The style to set.
	 * @param stylesToDelete The styles to delete.
	 */
	setStyle(style: ANSIStyle, ...stylesToDelete: ANSIStyle[]) {
		// Delete styles.
		this.deleteStyles(...stylesToDelete);

		// Set the style.
		this._styles.add(style);
	}

	/**
	 * Deletes styles.
	 * @param stylesToDelete The styles to delete.
	 */
	deleteStyles(...stylesToDelete: ANSIStyle[]) {
		stylesToDelete.forEach(style => this._styles.delete(style));
	}

	/**
	 * Sets the foreground color.
	 * @param color The foreground color.
	 */
	setForegroundColor(color?: ANSIColor | string) {
		if (!this._reversed) {
			this._foregroundColor = color;
		} else {
			this._backgroundColor = color;
		}
	}

	/**
	 * Sets the background color.
	 * @param color The background color.
	 */
	setBackgroundColor(color?: ANSIColor | string) {
		if (!this._reversed) {
			this._backgroundColor = color;
		} else {
			this._foregroundColor = color;
		}
	}

	/**
	 * Sets reversed.
	 * @param reversed A value which indicates whether the foreground and
	 * background colors are reversed.
	 */
	setReversed(reversed: boolean) {
		if (this._reversed !== reversed) {
			this._reversed = reversed;
			this.reverseForegroundAndBackgroundColors();
		}
	}

	/**
	 * Sets the font.
	 * @param font The font.
	 */
	setFont(font?: ANSIFont) {
		this._font = font;
	}

	/**
	 * Creates a copy of the SGRState.
	 * @returns The copy of the SGRState.
	 */
	copy(): SGRState {
		const copy = new SGRState();
		this._styles.forEach(style => copy._styles.add(style));
		copy._foregroundColor = this._foregroundColor;
		copy._backgroundColor = this._backgroundColor;
		copy._underlinedColor = this._underlinedColor;
		copy._reversed = this._reversed;
		copy._font = this._font;
		return copy;
	}

	/**
	 * Determines whether two SGRState objects are equal.
	 * @param left The first SGRState.
	 * @param right The second SGRState.
	 * @returns true, if the SGRState objects are equal; otherwise, false.
	 */
	static equals(left: SGRState, right: SGRState): boolean {
		// Compare styles size.
		if (left._styles.size !== right._styles.size) {
			return false;
		}

		// Compare styles.
		const aStyles = [...left._styles];
		const bStyles = [...right._styles];
		for (let i = 0; i < aStyles.length; i++) {
			if (aStyles[i] !== bStyles[i]) {
				return false;
			}
		}

		// Compare colors and font.
		return left._foregroundColor === right._foregroundColor &&
			left._backgroundColor === right._backgroundColor &&
			left._underlinedColor === right._underlinedColor &&
			left._reversed === right._reversed &&
			left._font === right._font;
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
	private _parserState = ParserState.BufferingOutput;

	/**
	 * Gets or sets the buffer.
	 */
	private _buffer = '';

	/**
	 * Gets or sets the control sequence that's being parsed.
	 */
	private _controlSequence = '';

	/**
	 * Gets or sets the SGR state.
	 */
	private _sgrState = new SGRState();

	/**
	 * The current set of output lines.
	 */
	private _outputLines: ANSIOutputLine[] = [];

	/**
	 * Gets the current output line.
	 */
	private _currentOutputLine = 0;

	/**
	 * Gets or sets a value which indicates whether there is a pending newline.
	 */
	private _pendingNewline = false;

	//#endregion Private Properties

	/**
	 * Processes output and returns the ANSIOutput lines of the output.
	 * @param output The output to process.
	 * @returns The ANSIOutput lines of the output.
	 */
	static processOutput(output: string) {
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(output);
		return ansiOutput.flushOutput();
	}

	//#region Public Methods

	/**
	 * Processes output.
	 * @param output The output to process.
	 * @returns The output lines.
	 */
	processOutput(output: string) {
		this.parseOutput(output);
	}

	/**
	 * Flushes the output and returns an array of output lines.
	 * @returns An array of output lines.
	 */
	flushOutput(): ANSIOutputLine[] {
		this.flushBuffer();
		return this._outputLines;
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Parses output.
	 * @param output The output to parse.
	 */
	private parseOutput(output: string) {
		// Enumerate the characters in the output.
		for (let i = 0; i < output.length; i++) {
			// Get the character.
			const char = output.charAt(i);

			// Parse the character.
			if (this._parserState === ParserState.BufferingOutput) {
				// Check for the start of an control sequence.
				if (char === '\x1b') {
					this._parserState = ParserState.ControlSequenceStarted;
				} else {
					this.processCharacter(char);
				}
			} else if (this._parserState === ParserState.ControlSequenceStarted) {
				// Check for CSI.
				if (char === '[') {
					this._parserState = ParserState.ParsingControlSequence;
				} else {
					// We encountered an ESC that is not part of a CSI. Ignore
					// the ESC, go back to the buffering output state, and
					// process the character.
					this._parserState = ParserState.BufferingOutput;
					this.processCharacter(char);
				}
			} else if (this._parserState === ParserState.ParsingControlSequence) {
				// Append the character to the control sequence.
				this._controlSequence += char;

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
		if (this._pendingNewline) {
			this._pendingNewline = false;
			this._currentOutputLine++;
		}

		// Handle special characters.
		if (char === '\n') {
			// Flush the buffer to the current output line.
			this.flushBuffer();
			this._pendingNewline = true;
		} else {
			// Buffer the character.
			this._buffer += char;
		}
	}

	/**
	 * Processes a control sequence.
	 */
	private processControlSequence() {
		// Process SGR control sequence.
		if (this._controlSequence.endsWith('m')) {
			this.processSGRControlSequence();
		} else {
			console.log(`Ignoring control sequence: CSI${this._controlSequence}`);
		}

		// Clear the control sequence and go back to the buffering output state.
		this._controlSequence = '';
		this._parserState = ParserState.BufferingOutput;
	}

	/**
	 * Processes an SGR control sequence.
	 */
	private processSGRControlSequence() {
		// Log.
		console.log(`Processing control sequence SGR: CSI${this._controlSequence}`);

		// Make a copy of the SGR state.
		const sgrState = this._sgrState.copy();

		// Parse the SGR parameters.
		const sgrParams = this._controlSequence
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
					sgrState.reset();
					break;

				case SGRParam.Bold:
					sgrState.setStyle(ANSIStyle.Bold);
					break;

				case SGRParam.Dim:
					sgrState.setStyle(ANSIStyle.Dim);
					break;

				case SGRParam.Italic:
					sgrState.setStyle(ANSIStyle.Italic);
					break;

				case SGRParam.Underlined:
					sgrState.setStyle(ANSIStyle.Underlined, ANSIStyle.DoubleUnderlined);
					break;

				case SGRParam.SlowBlink:
					sgrState.setStyle(ANSIStyle.SlowBlink, ANSIStyle.RapidBlink);
					break;

				case SGRParam.RapidBlink:
					sgrState.setStyle(ANSIStyle.RapidBlink, ANSIStyle.SlowBlink);
					break;

				case SGRParam.Reversed:
					sgrState.setReversed(true);
					break;

				case SGRParam.Hidden:
					sgrState.setStyle(ANSIStyle.Hidden);
					break;

				case SGRParam.CrossedOut:
					sgrState.setStyle(ANSIStyle.CrossedOut);
					break;

				case SGRParam.PrimaryFont:
					sgrState.setFont();
					break;

				case SGRParam.AlternativeFont1:
					sgrState.setFont(ANSIFont.AlternativeFont1);
					break;

				case SGRParam.AlternativeFont2:
					sgrState.setFont(ANSIFont.AlternativeFont2);
					break;

				case SGRParam.AlternativeFont3:
					sgrState.setFont(ANSIFont.AlternativeFont3);
					break;

				case SGRParam.AlternativeFont4:
					sgrState.setFont(ANSIFont.AlternativeFont4);
					break;
				case SGRParam.AlternativeFont5:
					sgrState.setFont(ANSIFont.AlternativeFont5);
					break;

				case SGRParam.AlternativeFont6:
					sgrState.setFont(ANSIFont.AlternativeFont6);
					break;

				case SGRParam.AlternativeFont7:
					sgrState.setFont(ANSIFont.AlternativeFont7);
					break;

				case SGRParam.AlternativeFont8:
					sgrState.setFont(ANSIFont.AlternativeFont8);
					break;

				case SGRParam.AlternativeFont9:
					sgrState.setFont(ANSIFont.AlternativeFont9);
					break;

				case SGRParam.Fraktur:
					sgrState.setStyle(ANSIStyle.Fraktur);
					break;

				case SGRParam.DoubleUnderlined:
					sgrState.setStyle(ANSIStyle.DoubleUnderlined, ANSIStyle.Underlined);
					break;

				case SGRParam.NormalIntensity:
					sgrState.deleteStyles(ANSIStyle.Bold, ANSIStyle.Dim);
					break;

				case SGRParam.NotItalicNotFraktur:
					sgrState.deleteStyles(ANSIStyle.Italic, ANSIStyle.Fraktur);
					break;

				case SGRParam.NotUnderlined:
					sgrState.deleteStyles(ANSIStyle.Underlined, ANSIStyle.DoubleUnderlined);
					break;

				case SGRParam.NotBlinking:
					sgrState.deleteStyles(ANSIStyle.SlowBlink, ANSIStyle.RapidBlink);
					break;

				case SGRParam.ProportionalSpacing:
					// Do nothing.
					break;

				case SGRParam.NotReversed:
					sgrState.setReversed(false);
					break;

				case SGRParam.Reveal:
					sgrState.deleteStyles(ANSIStyle.Hidden);
					break;

				case SGRParam.NotCrossedOut:
					sgrState.deleteStyles(ANSIStyle.CrossedOut);
					break;

				case SGRParam.ForegroundBlack:
					sgrState.setForegroundColor(ANSIColor.Black);
					break;

				case SGRParam.ForegroundRed:
					sgrState.setForegroundColor(ANSIColor.Red);
					break;

				case SGRParam.ForegroundGreen:
					sgrState.setForegroundColor(ANSIColor.Green);
					break;

				case SGRParam.ForegroundYellow:
					sgrState.setForegroundColor(ANSIColor.Yellow);
					break;

				case SGRParam.ForegroundBlue:
					sgrState.setForegroundColor(ANSIColor.Blue);
					break;

				case SGRParam.ForegroundMagenta:
					sgrState.setForegroundColor(ANSIColor.Magenta);
					break;

				case SGRParam.ForegroundCyan:
					sgrState.setForegroundColor(ANSIColor.Cyan);
					break;

				case SGRParam.ForegroundWhite:
					sgrState.setForegroundColor(ANSIColor.White);
					break;

				case SGRParam.SetForeground:
					// Get the 3 bit or 24 bit color.
					break;

				case SGRParam.DefaultForeground:
					sgrState.setForegroundColor();
					break;

				case SGRParam.BackgroundBlack:
					sgrState.setBackgroundColor(ANSIColor.Black);
					break;

				case SGRParam.BackgroundRed:
					sgrState.setBackgroundColor(ANSIColor.Red);
					break;

				case SGRParam.BackgroundGreen:
					sgrState.setBackgroundColor(ANSIColor.Green);
					break;

				case SGRParam.BackgroundYellow:
					sgrState.setBackgroundColor(ANSIColor.Yellow);
					break;

				case SGRParam.BackgroundBlue:
					sgrState.setBackgroundColor(ANSIColor.Blue);
					break;

				case SGRParam.BackgroundMagenta:
					sgrState.setBackgroundColor(ANSIColor.Magenta);
					break;

				case SGRParam.BackgroundCyan:
					sgrState.setBackgroundColor(ANSIColor.Cyan);
					break;

				case SGRParam.BackgroundWhite:
					sgrState.setBackgroundColor(ANSIColor.White);
					break;

				case SGRParam.ForegroundBrightBlack:
					sgrState.setForegroundColor(ANSIColor.BrightBlack);
					break;

				case SGRParam.ForegroundBrightRed:
					sgrState.setForegroundColor(ANSIColor.BrightRed);
					break;

				case SGRParam.ForegroundBrightGreen:
					sgrState.setForegroundColor(ANSIColor.BrightGreen);
					break;

				case SGRParam.ForegroundBrightYellow:
					sgrState.setForegroundColor(ANSIColor.BrightYellow);
					break;

				case SGRParam.ForegroundBrightBlue:
					sgrState.setForegroundColor(ANSIColor.BrightBlue);
					break;

				case SGRParam.ForegroundBrightMagenta:
					sgrState.setForegroundColor(ANSIColor.BrightMagenta);
					break;

				case SGRParam.ForegroundBrightCyan:
					sgrState.setForegroundColor(ANSIColor.BrightCyan);
					break;

				case SGRParam.ForegroundBrightWhite:
					sgrState.setForegroundColor(ANSIColor.BrightWhite);
					break;

				case SGRParam.BackgroundBrightBlack:
					sgrState.setBackgroundColor(ANSIColor.BrightBlack);
					break;

				case SGRParam.BackgroundBrightRed:
					sgrState.setBackgroundColor(ANSIColor.BrightRed);
					break;

				case SGRParam.BackgroundBrightGreen:
					sgrState.setBackgroundColor(ANSIColor.BrightGreen);
					break;

				case SGRParam.BackgroundBrightYellow:
					sgrState.setBackgroundColor(ANSIColor.BrightYellow);
					break;

				case SGRParam.BackgroundBrightBlue:
					sgrState.setBackgroundColor(ANSIColor.BrightBlue);
					break;

				case SGRParam.BackgroundBrightMagenta:
					sgrState.setBackgroundColor(ANSIColor.BrightMagenta);
					break;

				case SGRParam.BackgroundBrightCyan:
					sgrState.setBackgroundColor(ANSIColor.BrightCyan);
					break;

				case SGRParam.BackgroundBrightWhite:
					sgrState.setBackgroundColor(ANSIColor.BrightWhite);
					break;

				// Unexpected SGR parameter.
				default:
					console.log(`    Unexpected SGR parameter: ${sgrParam}`);
					break;
			}
		}

		// Detect changes.
		if (!SGRState.equals(sgrState, this._sgrState)) {
			this.flushBuffer();
			this._sgrState = sgrState;
		}
	}

	/**
	 * Flushes the buffer.
	 */
	private flushBuffer() {
		// Ensure that we have sufficient output lines.
		for (let i = this._outputLines.length; i < this._currentOutputLine + 1; i++) {
			this._outputLines.push({
				id: crypto.randomUUID(),
				outputRuns: []
			});
		}

		// If the buffer is empty, do nothing.
		if (!this._buffer) {
			return;
		}

		// Append the run to the current output line.
		this._outputLines[this._currentOutputLine].outputRuns.push(
			this._sgrState.createOutputRun(this._buffer)
		);

		// Clear the buffer.
		this._buffer = '';
	}

	//#endregion Private Methods
}

/**
 * ANSIStyle enumeration.
 */
export enum ANSIStyle {
	Bold = 'ansiBold',
	Dim = 'ansiDim',
	Italic = 'ansiItalic',
	Underlined = 'ansiUnderlined',
	SlowBlink = 'ansiSlowBlink',
	RapidBlink = 'ansiRapidBlink',
	Hidden = 'ansiHidden',
	CrossedOut = 'ansiCrossedOut',
	Fraktur = 'ansiFraktur',
	DoubleUnderlined = 'ansiDoubleUnderlined',
	Framed = 'ansiFramed',
	Encircled = 'ansiEncircled',
	Overlined = 'ansiOverlined',
	Superscript = 'ansiSuperscript',
	Subscript = 'ansiSubscript'
}

/**
 * ANSIFont enumeration.
 */
export enum ANSIFont {
	AlternativeFont1 = 'ansiAlternativeFont1',
	AlternativeFont2 = 'ansiAlternativeFont2',
	AlternativeFont3 = 'ansiAlternativeFont3',
	AlternativeFont4 = 'ansiAlternativeFont4',
	AlternativeFont5 = 'ansiAlternativeFont5',
	AlternativeFont6 = 'ansiAlternativeFont6',
	AlternativeFont7 = 'ansiAlternativeFont7',
	AlternativeFont8 = 'ansiAlternativeFont8',
	AlternativeFont9 = 'ansiAlternativeFont9'
}

/**
 * SGRColor enumeration.
 */
export enum ANSIColor {
	Black = 'ansiBlack',
	Red = 'ansiRed',
	Green = 'ansiGreen',
	Yellow = 'ansiYellow',
	Blue = 'ansiBlue',
	Magenta = 'ansiMagenta',
	Cyan = 'ansiCyan',
	White = 'ansiWhite',
	BrightBlack = 'ansiBrightBlack',
	BrightRed = 'ansiBrightRed',
	BrightGreen = 'ansiBrightGreen',
	BrightYellow = 'ansiBrightYellow',
	BrightBlue = 'ansiBrightBlue',
	BrightMagenta = 'ansiBrightMagenta',
	BrightCyan = 'ansiBrightCyan',
	BrightWhite = 'ansiBrightWhite'
}

/**
 * ANSIOutputLine interface.
 */
export interface ANSIOutputLine {
	/**
	 * The identifier of the line/
	 */
	id: string;

	/**
	 * The output runs that make up the output line.
	 */
	outputRuns: ANSIOutputRun[];
}

/**
* ANSIOutputRun interface.
*/
export interface ANSIOutputRun {
	/**
	 * Gets the identifier.
	 */
	readonly id: string;

	/**
	 * Gets the styles.
	 */
	readonly styles: ANSIStyle[];

	/**
	 * Gets the foreground color.
	 */
	readonly foregroundColor: ANSIColor | string | undefined;

	/**
	 * Gets the background color.
	 */
	readonly backgroundColor: ANSIColor | string | undefined;

	/**
	 * Gets the underlined color.
	 */
	readonly underlinedColor: string | undefined;

	/**
	 * Gets the font.
	 */
	readonly font: string | undefined;

	/**
	 * Gets the text.
	 */
	readonly text: string;
}
