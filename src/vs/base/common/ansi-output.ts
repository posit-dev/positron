/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';

//#region Exports

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
	 * Gets the identifier.
	 */
	readonly id: string;

	/**
	 * Gets the output runs.
	 */
	readonly outputRuns: ANSIOutputRun[];
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
	 * Gets the hyperlink.
	 */
	readonly hyperlink?: ANSIHyperlink;

	/**
	 * Gets the format.
	 */
	readonly format?: ANSIFormat;

	/**
	 * Gets the text.
	 */
	readonly text: string;
}

/**
* ANSIHyperlink interface.
*/
export interface ANSIHyperlink {
	/**
	 * Gets the URL.
	 */
	readonly url: string;

	/**
	 * Gets the params.
	 */
	readonly params?: Map<string, string>;
}

/**
 * ANSIFormat interface.
 */
export interface ANSIFormat {
	/**
	 * Gets the styles.
	 */
	readonly styles?: ANSIStyle[];

	/**
	 * Gets the foreground color.
	 */
	readonly foregroundColor?: ANSIColor | string;

	/**
	 * Gets the background color.
	 */
	readonly backgroundColor?: ANSIColor | string;

	/**
	 * Gets the underlined color.
	 */
	readonly underlinedColor?: string;

	/**
	 * Gets the font.
	 */
	readonly font?: string;
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
	 * Gets or sets the control sequence that's being parsed.
	 */
	private _cs = '';

	/**
	 * Gets or sets the SGR state.
	 */
	private _sgrState?: SGRState = undefined;

	/**
	 * Gets or sets the operating system command that's being parsed.
	 */
	private _osc = '';

	/**
	 * Gets or sets the current set of output lines.
	 */
	private _outputLines: OutputLine[] = [];

	/**
	 * Gets or sets the output line.
	 */
	private _outputLine = 0;

	/**
	 * Gets or sets the output column.
	 */
	private _outputColumn = 0;

	/**
	 * Gets or sets the buffer.
	 */
	private _buffer = '';

	/**
	 * Gets or sets a value which indicates whether there is a pending newline.
	 */
	private _pendingNewline = false;

	/**
	 * Gets or sets the hyperlink that is active.
	 */
	private _hyperlink?: Hyperlink;

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets a value which indicates whether this ANSIOutput is buffering.
	 */
	get isBuffering() {
		return this._parserState === ParserState.BufferingOutput;
	}

	/**
	 * Gets the output lines.
	 */
	get outputLines() {
		this.flushBuffer();
		return this._outputLines;
	}

	//#endregion Public Properties

	//#region Public Static Methods

	/**
	 * Processes output and returns the ANSIOutput lines of the output.
	 * @param output The output to process.
	 * @returns The ANSIOutput lines of the output.
	 */
	public static processOutput(output: string) {
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(output);
		return ansiOutput.outputLines;
	}

	//#endregion Public Static Methods

	//#region Public Methods

	/**
	 * Copies styles from another ANSIOutput to this ANSIOutput.
	 * @param ansiOutput The ANSIOutput to copy styles from.
	 */
	copyStylesFrom(ansiOutput: ANSIOutput) {
		this._sgrState = ansiOutput._sgrState?.copy();
	}

	/**
	 * Processes output.
	 * @param output The output to process.
	 */
	processOutput(output: string) {
		// Enumerate the characters in the output.
		for (let i = 0; i < output.length; i++) {
			// If there is a pending newline, process it.
			if (this._pendingNewline) {
				// Flush the buffer.
				this.flushBuffer();

				// Increment the output line and reset the output column.
				this._outputLine++;
				this._outputColumn = 0;

				// Clear the pending newline flag.
				this._pendingNewline = false;
			}

			// Get the character.
			const char = output.charAt(i);

			// Process the character.
			switch (this._parserState) {
				// If the parser is buffering output, look for ESC, CSI, or OSC.
				case ParserState.BufferingOutput: {
					// Look for ESC, CSI, or OSC.
					switch (char) {
						// ESC.
						case '\x1b': {
							// Flush the buffer.
							this.flushBuffer();

							// Enter the escape sequence started state.
							this._parserState = ParserState.EscapeSequenceStarted;
							break;
						}

						// CSI.
						case '\x9b': {
							// Flush the buffer.
							this.flushBuffer();

							// Enter the parsing control sequence state.
							this._cs = '';
							this._parserState = ParserState.ParsingControlSequence;
							break;
						}

						// OSC.
						case '\x9d': {
							// Flush the buffer.
							this.flushBuffer();

							// Enter the parsing operating system command state.
							this._osc = '';
							this._parserState = ParserState.ParsingOperatingSystemCommand;
							break;
						}

						// Other characters.
						default: {
							// Process the character.
							this.processCharacter(char);
							break;
						}
					}
					break;
				}

				// If the parser is at the start of an escape sequence, look for CSI or OSC.
				case ParserState.EscapeSequenceStarted: {
					// Look for CSI or OSC.
					switch (char) {
						// CSI.
						case '[': {
							// Enter the parsing control sequence state.
							this._cs = '';
							this._parserState = ParserState.ParsingControlSequence;
							break;
						}

						// OSC.
						case ']': {
							// Enter the parsing operating system command state.
							this._osc = '';
							this._parserState = ParserState.ParsingOperatingSystemCommand;
							break;
						}

						// Unexpected character.
						default: {
							// We encountered an ESC that is not part of a CSI or OSC. Ignore the
							// ESC, return to the buffering output state, and process the character.
							this._parserState = ParserState.BufferingOutput;

							// Process the character.
							this.processCharacter(char);
							break;
						}
					}
					break;
				}

				// Parsing a control sequence.
				case ParserState.ParsingControlSequence: {
					// Append the character to the control sequence.
					this._cs += char;

					// If this character ends the control sequence, process it.
					if (char.match(/^[A-Za-z]$/)) {
						this.processControlSequence();
					}
					break;
				}

				// Parsing an operating system command.
				case ParserState.ParsingOperatingSystemCommand: {
					// Append the character to the operating system command.
					this._osc += char;

					// If we parsed an operating system command, process it.
					const match = this._osc.match(/^(.*)(?:\x1b\x5c|\x07|\x9c)$/);
					if (match && match.length === 2) {
						this._osc = match[1];
						this.processOperatingSystemCommand();
					}
					break;
				}
			}
		}

		// Flush the buffer at the end of the output.
		this.flushBuffer();
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Flushes the buffer to the output line.
	 */
	private flushBuffer() {
		// Ensure that we have sufficient output lines in the output lines array.
		for (let i = this._outputLines.length; i < this._outputLine + 1; i++) {
			this._outputLines.push(new OutputLine());
		}

		// If the buffer isn't empty, flush it.
		if (this._buffer) {
			// Get the output line.
			const outputLine = this._outputLines[this._outputLine];

			// Insert the buffer into the output line.
			outputLine.insert(this._buffer, this._outputColumn, this._sgrState, this._hyperlink);

			// Adjust the output column and empty the buffer.
			this._outputColumn += this._buffer.length;
			this._buffer = '';
		}
	}

	/**
	 * Processes a character.
	 * @param char The character.
	 */
	private processCharacter(char: string) {
		// Handle special characters. Otherwise, buffer the character.
		switch (char) {
			// LF sets the pending newline flag.
			case '\n': {
				this._pendingNewline = true;
				break;
			}

			// CR flushes the buffer and sets the output column to 0.
			case '\r': {
				this.flushBuffer();
				this._outputColumn = 0;
				break;
			}

			// Buffer the character.
			default: {
				this._buffer += char;
				break;
			}
		}
	}

	/**
	 * Processes a control sequence.
	 */
	private processControlSequence() {
		// Process the control sequence.
		switch (this._cs.charAt(this._cs.length - 1)) {
			// CUU (Cursor Up).
			case 'A': {
				this.processCUU();
				break;
			}

			// CUD (Cursor Down).
			case 'B': {
				this.processCUD();
				break;
			}

			// CUF (Cursor Forward).
			case 'C': {
				this.processCUF();
				break;
			}

			// CUB (Cursor Backward).
			case 'D': {
				this.processCUB();
				break;
			}

			// CUP (Cursor Position).
			case 'H': {
				this.processCUP();
				break;
			}

			// ED (Erase in Display).
			case 'J': {
				this.processED();
				break;
			}

			// EL (Erase in Line).
			case 'K': {
				this.processEL();
				break;
			}

			// SGR (Select Graphic Rendition).
			case 'm': {
				this.processSGR();
				break;
			}

			// Unsupported control sequence.
			default: {
				break;
			}
		}

		// Return to the buffering output state.
		this._parserState = ParserState.BufferingOutput;
	}

	/**
	 * Processes a CUU (Cursor Up) control sequence.
	 */
	private processCUU() {
		// Match the control sequence.
		const match = this._cs.match(/^([0-9]*)A$/);
		if (match) {
			this._outputLine = Math.max(this._outputLine - rangeParam(match[1], 1, 1), 0);
		}
	}

	/**
	 * Processes a CUD (Cursor Down) control sequence.
	 */
	private processCUD() {
		// Match the control sequence.
		const match = this._cs.match(/^([0-9]*)B$/);
		if (match) {
			this._outputLine = this._outputLine + rangeParam(match[1], 1, 1);
		}
	}

	/**
	 * Processes a CUF (Cursor Forward) control sequence.
	 */
	private processCUF() {
		// Match the control sequence.
		const match = this._cs.match(/^([0-9]*)C$/);
		if (match) {
			this._outputColumn = this._outputColumn + rangeParam(match[1], 1, 1);
		}
	}

	/**
	 * Processes a CUB (Cursor Backward) control sequence.
	 */
	private processCUB() {
		// Match the control sequence.
		const match = this._cs.match(/^([0-9]*)D$/);
		if (match) {
			this._outputColumn = Math.max(this._outputColumn - rangeParam(match[1], 1, 1), 0);
		}
	}

	/**
	 * Processes a CUP (Cursor Position) control sequence.
	 */
	private processCUP() {
		// Match the control sequence.
		const match = this._cs.match(/^([0-9]*)(?:;?([0-9]*))H$/);
		if (match) {
			this._outputLine = rangeParam(match[1], 1, 1) - 1;
			this._outputColumn = rangeParam(match[2], 1, 1) - 1;
		}
	}

	/**
	 * Processes an ED (Erase in Display) control sequence.
	 */
	private processED() {
		// Match the control sequence.
		const match = this._cs.match(/^([0-9]*)J$/);
		if (match) {
			// Process the parameter.
			switch (getParam(match[1], 0)) {
				// Clear from cursor to the end of the screen.
				case 0: {
					this._outputLines[this._outputLine].clearToEndOfLine(this._outputColumn);
					for (let i = this._outputLine + 1; i < this._outputLines.length; i++) {
						this._outputLines[i].clearEntireLine();
					}
					break;
				}

				// Clear from cursor to the beginning of the screen.
				case 1: {
					this._outputLines[this._outputLine].clearToBeginningOfLine(this._outputColumn);
					for (let i = 0; i < this._outputLine; i++) {
						this._outputLines[i].clearEntireLine();
					}
					break;
				}

				// Clear the entire screen.
				case 2: {
					for (let i = 0; i < this._outputLines.length; i++) {
						this._outputLines[i].clearEntireLine();
					}
					break;
				}
			}
		}
	}

	/**
	 * Processes an EL (Erase in Line) control sequence.
	 */
	private processEL() {
		// Match the control sequence.
		const match = this._cs.match(/^([0-9]*)K$/);
		if (match) {
			// Get the output line.
			const outputLine = this._outputLines[this._outputLine];

			// Process the parameter.
			switch (getParam(match[1], 0)) {
				// Clear from cursor to the end of the line.
				case 0: {
					outputLine.clearToEndOfLine(this._outputColumn);
					break;
				}

				// Clear from cursor to the beginning of the line.
				case 1: {
					outputLine.clearToBeginningOfLine(this._outputColumn);
					break;
				}

				// Clear the entire line.
				case 2: {
					outputLine.clearEntireLine();
					break;
				}
			}
		}
	}

	/**
	 * Processes an SGR (Select Graphic Rendition) control sequence.
	 */
	private processSGR() {
		// Create the working SGR state.
		const sgrState = this._sgrState ? this._sgrState.copy() : new SGRState();

		// Parse the SGR parameters.
		const sgrParams = this._cs
			// Remove ending character.
			.slice(0, -1)
			// Split the SGR parameters.
			.split(';')
			// Parse the parameters. An empty parameter is a reset. (As an
			// exampple, CSI31;m does not produce red output.)
			.map(sgrParam => sgrParam === '' ? SGRParam.Reset : parseInt(sgrParam, 10));

		// Process the SGR parameters.
		for (let index = 0; index < sgrParams.length; index++) {
			// Get the SGR parameter.
			const sgrParam = sgrParams[index];

			/**
			 * Process SetForeground, SetBackground, or SetUnderline. Contrary to information you
			 * will find on the web, these parameters can be combined with other parameters. As an
			 * example:
			 *
			 * For the 256-color palette:
			 * \x1b[31;38;5;196mThis will be red\x1b[m
			 * \x1b[31;38;5;20mThis will be blue\x1b[m
			 *
			 * For RGB:
			 * \x1b[31;38;2;255;0;0mThis will be red\x1b[m
			 * \x1b[31;38;2;0;0;255mThis will be blue\x1b[m
			 */
			const processSetColor = (): ANSIColor | string | undefined => {
				// If there isn't an SGRColorParam in the parameters, return undefined to indicate
				// that we did not process the set color.
				if (index + 1 === sgrParams.length) {
					return undefined;
				}

				// Advance to the next parameter and process the SGRColorParam,
				// which should be next.
				switch (sgrParams[++index]) {
					// SGRColorParam.Color256 is an indexed color.
					case SGRParamColor.Color256: {
						// If there isn't an indexed color parameter, return undefined to indicate
						// that we did not process the set color.
						if (index + 1 === sgrParams.length) {
							return undefined;
						}

						// Get the color index.
						const colorIndex = sgrParams[++index];

						// Process the color index. The first 16 indexes map to normal ANSIColors.
						switch (colorIndex) {
							case SGRParamIndexedColor.Black: {
								return ANSIColor.Black;
							}

							case SGRParamIndexedColor.Red: {
								return ANSIColor.Red;
							}

							case SGRParamIndexedColor.Green: {
								return ANSIColor.Green;
							}

							case SGRParamIndexedColor.Yellow: {
								return ANSIColor.Yellow;
							}

							case SGRParamIndexedColor.Blue: {
								return ANSIColor.Blue;
							}

							case SGRParamIndexedColor.Magenta: {
								return ANSIColor.Magenta;
							}

							case SGRParamIndexedColor.Cyan: {
								return ANSIColor.Cyan;
							}

							case SGRParamIndexedColor.White: {
								return ANSIColor.White;
							}

							case SGRParamIndexedColor.BrightBlack: {
								return ANSIColor.BrightBlack;
							}

							case SGRParamIndexedColor.BrightRed: {
								return ANSIColor.BrightRed;
							}

							case SGRParamIndexedColor.BrightGreen: {
								return ANSIColor.BrightGreen;
							}

							case SGRParamIndexedColor.BrightYellow: {
								return ANSIColor.BrightYellow;
							}

							case SGRParamIndexedColor.BrightBlue: {
								return ANSIColor.BrightBlue;
							}

							case SGRParamIndexedColor.BrightMagenta: {
								return ANSIColor.BrightMagenta;
							}

							case SGRParamIndexedColor.BrightCyan: {
								return ANSIColor.BrightCyan;
							}

							case SGRParamIndexedColor.BrightWhite: {
								return ANSIColor.BrightWhite;
							}

							// Process other color indexes.
							default: {
								// Sanity check that the color index is an integer.
								if (colorIndex % 1 !== 0) {
									return undefined;
								}

								// Process the color index as RGB or grayscale.
								if (colorIndex >= 16 && colorIndex <= 231) {
									// Convert the color index to one of 216 RGB colors.
									let colorNumber = colorIndex - 16;
									let blue = colorNumber % 6;
									colorNumber = (colorNumber - blue) / 6;
									let green = colorNumber % 6;
									colorNumber = (colorNumber - green) / 6;
									let red = colorNumber;

									// Map red, green, and blue from 0-5 to 0-255.
									blue = Math.round(blue * 255 / 5);
									green = Math.round(green * 255 / 5);
									red = Math.round(red * 255 / 5);

									// Return the RGB color.
									return '#' +
										twoDigitHex(red) +
										twoDigitHex(green) +
										twoDigitHex(blue);
								} else if (colorIndex >= 232 && colorIndex <= 255) {
									// Calculate the grayscale value.
									const rgb = Math.round((colorIndex - 232) / 23 * 255);
									const grayscale = twoDigitHex(rgb);

									// Return the RGB color.
									return '#' + grayscale + grayscale + grayscale;
								} else {
									// Wonky!
									return undefined;
								}
							}
						}
					}

					// SGRParamColor.ColorRGB is an r;g;b color.
					case SGRParamColor.ColorRGB: {
						// The r;g;b components are optional.
						const rgb = [0, 0, 0];
						for (let i = 0; i < 3 && index + 1 < sgrParams.length; i++) {
							rgb[i] = sgrParams[++index];
						}

						// Return the RGB color.
						return '#' +
							twoDigitHex(rgb[0]) +
							twoDigitHex(rgb[1]) +
							twoDigitHex(rgb[2]);
					}
				}

				// The set color was not regognized.
				return undefined;
			};

			// Process the SGR parameter.
			switch (sgrParam) {
				case SGRParam.Reset: {
					sgrState.reset();
					break;
				}

				case SGRParam.Bold: {
					sgrState.setStyle(ANSIStyle.Bold);
					break;
				}

				case SGRParam.Dim: {
					sgrState.setStyle(ANSIStyle.Dim);
					break;
				}

				case SGRParam.Italic: {
					sgrState.setStyle(ANSIStyle.Italic);
					break;
				}

				case SGRParam.Underlined: {
					sgrState.setStyle(ANSIStyle.Underlined, ANSIStyle.DoubleUnderlined);
					break;
				}

				case SGRParam.SlowBlink: {
					sgrState.setStyle(ANSIStyle.SlowBlink, ANSIStyle.RapidBlink);
					break;
				}

				case SGRParam.RapidBlink: {
					sgrState.setStyle(ANSIStyle.RapidBlink, ANSIStyle.SlowBlink);
					break;
				}

				case SGRParam.Reversed: {
					sgrState.setReversed(true);
					break;
				}

				case SGRParam.Hidden: {
					sgrState.setStyle(ANSIStyle.Hidden);
					break;
				}

				case SGRParam.CrossedOut: {
					sgrState.setStyle(ANSIStyle.CrossedOut);
					break;
				}

				case SGRParam.PrimaryFont: {
					sgrState.setFont();
					break;
				}

				case SGRParam.AlternativeFont1: {
					sgrState.setFont(ANSIFont.AlternativeFont1);
					break;
				}

				case SGRParam.AlternativeFont2: {
					sgrState.setFont(ANSIFont.AlternativeFont2);
					break;
				}

				case SGRParam.AlternativeFont3: {
					sgrState.setFont(ANSIFont.AlternativeFont3);
					break;
				}

				case SGRParam.AlternativeFont4: {
					sgrState.setFont(ANSIFont.AlternativeFont4);
					break;
				}

				case SGRParam.AlternativeFont5: {
					sgrState.setFont(ANSIFont.AlternativeFont5);
					break;
				}

				case SGRParam.AlternativeFont6: {
					sgrState.setFont(ANSIFont.AlternativeFont6);
					break;
				}

				case SGRParam.AlternativeFont7: {
					sgrState.setFont(ANSIFont.AlternativeFont7);
					break;
				}

				case SGRParam.AlternativeFont8: {
					sgrState.setFont(ANSIFont.AlternativeFont8);
					break;
				}

				case SGRParam.AlternativeFont9: {
					sgrState.setFont(ANSIFont.AlternativeFont9);
					break;
				}

				case SGRParam.Fraktur: {
					sgrState.setStyle(ANSIStyle.Fraktur);
					break;
				}

				case SGRParam.DoubleUnderlined: {
					sgrState.setStyle(ANSIStyle.DoubleUnderlined, ANSIStyle.Underlined);
					break;
				}

				case SGRParam.NormalIntensity: {
					sgrState.deleteStyles(ANSIStyle.Bold, ANSIStyle.Dim);
					break;
				}

				case SGRParam.NotItalicNotFraktur: {
					sgrState.deleteStyles(ANSIStyle.Italic, ANSIStyle.Fraktur);
					break;
				}

				case SGRParam.NotUnderlined: {
					sgrState.deleteStyles(ANSIStyle.Underlined, ANSIStyle.DoubleUnderlined);
					break;
				}

				case SGRParam.NotBlinking: {
					sgrState.deleteStyles(ANSIStyle.SlowBlink, ANSIStyle.RapidBlink);
					break;
				}

				case SGRParam.ProportionalSpacing: {
					// Do nothing.
					break;
				}

				case SGRParam.NotReversed: {
					sgrState.setReversed(false);
					break;
				}

				case SGRParam.Reveal: {
					sgrState.deleteStyles(ANSIStyle.Hidden);
					break;
				}

				case SGRParam.NotCrossedOut: {
					sgrState.deleteStyles(ANSIStyle.CrossedOut);
					break;
				}

				case SGRParam.ForegroundBlack: {
					sgrState.setForegroundColor(ANSIColor.Black);
					break;
				}

				case SGRParam.ForegroundRed: {
					sgrState.setForegroundColor(ANSIColor.Red);
					break;
				}

				case SGRParam.ForegroundGreen: {
					sgrState.setForegroundColor(ANSIColor.Green);
					break;
				}

				case SGRParam.ForegroundYellow: {
					sgrState.setForegroundColor(ANSIColor.Yellow);
					break;
				}

				case SGRParam.ForegroundBlue: {
					sgrState.setForegroundColor(ANSIColor.Blue);
					break;
				}

				case SGRParam.ForegroundMagenta: {
					sgrState.setForegroundColor(ANSIColor.Magenta);
					break;
				}

				case SGRParam.ForegroundCyan: {
					sgrState.setForegroundColor(ANSIColor.Cyan);
					break;
				}

				case SGRParam.ForegroundWhite: {
					sgrState.setForegroundColor(ANSIColor.White);
					break;
				}

				case SGRParam.SetForeground: {
					const foregroundColor = processSetColor();
					if (foregroundColor) {
						sgrState.setForegroundColor(foregroundColor);
					}
					break;
				}

				case SGRParam.DefaultForeground: {
					sgrState.setForegroundColor();
					break;
				}

				case SGRParam.BackgroundBlack: {
					sgrState.setBackgroundColor(ANSIColor.Black);
					break;
				}

				case SGRParam.BackgroundRed: {
					sgrState.setBackgroundColor(ANSIColor.Red);
					break;
				}

				case SGRParam.BackgroundGreen: {
					sgrState.setBackgroundColor(ANSIColor.Green);
					break;
				}

				case SGRParam.BackgroundYellow: {
					sgrState.setBackgroundColor(ANSIColor.Yellow);
					break;
				}

				case SGRParam.BackgroundBlue: {
					sgrState.setBackgroundColor(ANSIColor.Blue);
					break;
				}

				case SGRParam.BackgroundMagenta: {
					sgrState.setBackgroundColor(ANSIColor.Magenta);
					break;
				}

				case SGRParam.BackgroundCyan: {
					sgrState.setBackgroundColor(ANSIColor.Cyan);
					break;
				}

				case SGRParam.BackgroundWhite: {
					sgrState.setBackgroundColor(ANSIColor.White);
					break;
				}

				case SGRParam.SetBackground: {
					const backgroundColor = processSetColor();
					if (backgroundColor) {
						sgrState.setBackgroundColor(backgroundColor);
					}
					break;
				}

				case SGRParam.DefaultBackground: {
					sgrState.setBackgroundColor();
					break;
				}

				case SGRParam.ForegroundBrightBlack: {
					sgrState.setForegroundColor(ANSIColor.BrightBlack);
					break;
				}

				case SGRParam.ForegroundBrightRed: {
					sgrState.setForegroundColor(ANSIColor.BrightRed);
					break;
				}

				case SGRParam.ForegroundBrightGreen: {
					sgrState.setForegroundColor(ANSIColor.BrightGreen);
					break;
				}

				case SGRParam.ForegroundBrightYellow: {
					sgrState.setForegroundColor(ANSIColor.BrightYellow);
					break;
				}

				case SGRParam.ForegroundBrightBlue: {
					sgrState.setForegroundColor(ANSIColor.BrightBlue);
					break;
				}

				case SGRParam.ForegroundBrightMagenta: {
					sgrState.setForegroundColor(ANSIColor.BrightMagenta);
					break;
				}

				case SGRParam.ForegroundBrightCyan: {
					sgrState.setForegroundColor(ANSIColor.BrightCyan);
					break;
				}

				case SGRParam.ForegroundBrightWhite: {
					sgrState.setForegroundColor(ANSIColor.BrightWhite);
					break;
				}

				case SGRParam.BackgroundBrightBlack: {
					sgrState.setBackgroundColor(ANSIColor.BrightBlack);
					break;
				}

				case SGRParam.BackgroundBrightRed: {
					sgrState.setBackgroundColor(ANSIColor.BrightRed);
					break;
				}

				case SGRParam.BackgroundBrightGreen: {
					sgrState.setBackgroundColor(ANSIColor.BrightGreen);
					break;
				}

				case SGRParam.BackgroundBrightYellow: {
					sgrState.setBackgroundColor(ANSIColor.BrightYellow);
					break;
				}

				case SGRParam.BackgroundBrightBlue: {
					sgrState.setBackgroundColor(ANSIColor.BrightBlue);
					break;
				}

				case SGRParam.BackgroundBrightMagenta: {
					sgrState.setBackgroundColor(ANSIColor.BrightMagenta);
					break;
				}

				case SGRParam.BackgroundBrightCyan: {
					sgrState.setBackgroundColor(ANSIColor.BrightCyan);
					break;
				}

				case SGRParam.BackgroundBrightWhite: {
					sgrState.setBackgroundColor(ANSIColor.BrightWhite);
					break;
				}

				// Unexpected SGR parameter.
				default: {
					break;
				}
			}
		}

		// Detect changes in SGR state.
		if (!SGRState.equivalent(sgrState, this._sgrState)) {
			this._sgrState = sgrState;
		}
	}

	/**
	 * Processes an operating system command.
	 */
	private processOperatingSystemCommand() {
		// Match the operating system command number an payload.
		const match = this._osc.match(/^([0-9]+);(.*)$/);
		if (match && match.length === 3) {
			// Set the operating system command payload.
			this._osc = match[2];

			// Switch on the operating system command number.
			switch (match[1]) {
				// OSC 8.
				case '8': {
					this.processOSC8();
					break;
				}

				// Unsupported operating system command.
				default: {
					break;
				}
			}
		}

		// Return to the buffering output state.
		this._parserState = ParserState.BufferingOutput;
	}

	/**
	 * Processes an OSC 8 (anchor).
	 */
	private processOSC8() {
		// Assume that we didn't find a hyperlink.
		let hyperlink: Hyperlink | undefined = undefined;

		// Match the hyperlink and the hyperlink params. If we have a match, process the hyperlink
		// further.
		const match = this._osc.match(/^(.*?);(.*?)$/);
		if (match && match.length === 3) {
			// Get the URL.
			const url = match[2].trim();

			// If the URL has a value, create the hyperlink.
			if (url) {
				// Create the hyperlink.
				hyperlink = new Hyperlink(url, match[1].trim());
			}
		}

		// Set the hyperlink.
		this._hyperlink = hyperlink;
	}

	//#endregion Private Methods
}

//#endregion Exports

//#region Private Enumerations

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
 * SGRParamColor enumeration.
 */
enum SGRParamColor {
	Color256 = 5,
	ColorRGB = 2
}

/**
 * SGRParamIndexedColor enumeration.
 */
enum SGRParamIndexedColor {
	Black = 0,
	Red = 1,
	Green = 2,
	Yellow = 3,
	Blue = 4,
	Magenta = 5,
	Cyan = 6,
	White = 7,
	BrightBlack = 8,
	BrightRed = 9,
	BrightGreen = 10,
	BrightYellow = 11,
	BrightBlue = 12,
	BrightMagenta = 13,
	BrightCyan = 14,
	BrightWhite = 15
}

/**
 * ParserState enumeration.
 */
enum ParserState {
	BufferingOutput,
	EscapeSequenceStarted,
	ParsingControlSequence,
	ParsingOperatingSystemCommand
}

//#endregion Private Enumerations

//#region Private Classes

/**
 * SGRState class.
 */
class SGRState implements ANSIFormat {
	//#region Private Properties.

	/**
	 * Gets or sets the styles.
	 */
	private _styles?: Set<ANSIStyle>;

	/**
	 * Gets or sets the foreground color.
	 */
	private _foregroundColor?: ANSIColor | string;

	/**
	 * Gets or sets the background color.
	 */
	private _backgroundColor?: ANSIColor | string;

	/**
	 * Gets or sets the underlined color.
	 */
	private _underlinedColor?: string;

	/**
	 * Gets or sets a value which indicates whether the foreground and background colors are
	 * reversed.
	 */
	private _reversed?: boolean;

	/**
	 * Gets or sets the font.
	 */
	private _font?: ANSIFont;

	//#endregion Private Properties.

	//#region Public Static Methods

	/**
	 * Determines whether two SGRStates are equivalent.
	 * @param sgrState1 The 1st SGRState.
	 * @param sgrState2 The 2nd SGRState.
	 * @returns A value which indicates whether the two SGRStates are equivalent.
	 */
	public static equivalent(sgrState1?: SGRState, sgrState2?: SGRState) {
		// The set replacer.
		const setReplacer = (_: any, value: any) =>
			value instanceof Set ? !value.size ? undefined : Array.from(value) : value;

		// Determines whether the two SGRStates are equivalent.
		return sgrState1 === sgrState2 ||
			JSON.stringify(sgrState1, setReplacer) === JSON.stringify(sgrState2, setReplacer);
	}

	//#endregion Public Static Methods

	//#region Public Methods

	/**
	 * Resets the SGRState.
	 */
	reset() {
		this._styles = undefined;
		this._foregroundColor = undefined;
		this._backgroundColor = undefined;
		this._underlinedColor = undefined;
		this._reversed = undefined;
		this._font = undefined;
	}

	/**
	 * Creates a copy of the SGRState.
	 * @returns The copy of the SGRState.
	 */
	copy(): SGRState {
		const copy = new SGRState();
		if (this._styles && this._styles.size) {
			const styles = new Set<ANSIStyle>();
			this._styles.forEach(style => styles.add(style));
			copy._styles = styles;
		}
		copy._foregroundColor = this._foregroundColor;
		copy._backgroundColor = this._backgroundColor;
		copy._underlinedColor = this._underlinedColor;
		copy._reversed = this._reversed;
		copy._font = this._font;
		return copy;
	}

	/**
	 * Sets a style.
	 * @param style The style to set.
	 * @param stylesToDelete The styles to delete.
	 */
	setStyle(style: ANSIStyle, ...stylesToDelete: ANSIStyle[]) {
		if (this._styles) {
			for (const style of stylesToDelete) {
				this._styles.delete(style);
			}
		} else {
			this._styles = new Set<ANSIStyle>();
		}

		// Set the style.
		this._styles.add(style);
	}

	/**
	 * Deletes styles.
	 * @param stylesToDelete The styles to delete.
	 */
	deleteStyles(...stylesToDelete: ANSIStyle[]) {
		if (this._styles) {
			for (const style of stylesToDelete) {
				this._styles.delete(style);
			}

			if (!this._styles.size) {
				this._styles = undefined;
			}
		}
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
	 * @param reversed A value which indicates whether the foreground and background colors are
	 * reversed.
	 */
	setReversed(reversed: boolean) {
		if (reversed) {
			if (!this._reversed) {
				this._reversed = true;
				this.reverseForegroundAndBackgroundColors();
			}
		} else {
			if (this._reversed) {
				this._reversed = undefined;
				this.reverseForegroundAndBackgroundColors();
			}
		}
	}

	/**
	 * Sets the font.
	 * @param font The font.
	 */
	setFont(font?: ANSIFont) {
		// Set the font.
		this._font = font;
	}

	//#endregion Public Methods

	//#region ANSIFormat Implementation

	/**
	 * Gets the styles.
	 */
	public get styles() {
		return !this._styles ? undefined : Array.from(this._styles);
	}

	/**
	 * Gets the foreground color.
	 */
	public get foregroundColor() {
		// When a background color is set and a foreground color is not set,
		// and the background color is one of the standard colors, return a
		// contrasting foreground color.
		if (this._backgroundColor && !this._foregroundColor) {
			switch (this._backgroundColor) {
				case ANSIColor.Black:
				case ANSIColor.BrightBlack:
				case ANSIColor.Red:
				case ANSIColor.BrightRed: {
					return ANSIColor.White;
				}

				case ANSIColor.Green:
				case ANSIColor.BrightGreen:
				case ANSIColor.Yellow:
				case ANSIColor.BrightYellow:
				case ANSIColor.Blue:
				case ANSIColor.BrightBlue:
				case ANSIColor.Magenta:
				case ANSIColor.BrightMagenta:
				case ANSIColor.Cyan:
				case ANSIColor.BrightCyan:
				case ANSIColor.White:
				case ANSIColor.BrightWhite: {
					return ANSIColor.Black;
				}
			}
		}

		// Return the foreground color.
		return this._foregroundColor;
	}

	/**
	 * Gets the background color.
	 */
	public get backgroundColor() {
		return this._backgroundColor;
	}

	/**
	 * Gets the underlined color.
	 */
	public get underlinedColor() {
		return this._underlinedColor;
	}

	/**
	 * Gets the font.
	 */
	public get font() {
		return this._font;
	}

	//#endregion ANSIFormat Implementation

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
 * OutputLine class.
 */
class OutputLine implements ANSIOutputLine {
	//#region Private Properties

	/**
	 * Gets the identifier.
	 */
	private _id = generateId();

	/**
	 * Gets or sets the output runs.
	 */
	private _outputRuns: OutputRun[] = [];

	/**
	 * Gets or sets the total length.
	 */
	private _totalLength = 0;

	//#endregion Private Properties

	//#region Public Methods

	/**
	 * Clears the entire output line.
	 */
	public clearEntireLine() {
		// If there are output runs, replace them all with an empty output run.
		if (this._totalLength) {
			this._outputRuns = [new OutputRun(' '.repeat(this._totalLength))];
		}
	}

	/**
	 * Clears to the end of the output line.
	 * @param column The column at which to clear from.
	 */
	public clearToEndOfLine(column: number) {
		// Sanity check the column.
		column = Math.max(column, 0);

		// If there's nothing to clear, return.
		if (column >= this._totalLength) {
			return;
		}

		// If the column is 0, clear the entire line and return.
		if (column === 0) {
			this.clearEntireLine();
			return;
		}

		// Find the left output run that is impacted.
		let leftOffset = 0;
		let leftOutputRun: OutputRun | undefined;
		let leftOutputRunIndex: number | undefined = undefined;
		for (let index = 0; index < this._outputRuns.length; index++) {
			// Get the output run.
			const outputRun = this._outputRuns[index];

			// If the column intersects with this output run, the left output run has been found.
			if (column < leftOffset + outputRun.text.length) {
				leftOutputRun = outputRun;
				leftOutputRunIndex = index;
				break;
			}

			// Adjust the left output run offset.
			leftOffset += outputRun.text.length;
		}

		// If the left output run wasn't found, there's an egregious bug in this code. Just return
		// in this case. (There's a bit of a TypeScript failure here. It doesn't detect that both
		// leftOutputRun and leftOutputRunIndex will both be undefined if one of them is undefined.)
		if (leftOutputRun === undefined || leftOutputRunIndex === undefined) {
			return;
		}

		// Get the left text length.
		const leftTextLength = column - leftOffset;

		// Build the new output runs.
		const erasureText = ' '.repeat(this._totalLength - column);
		const outputRuns: OutputRun[] = [];
		if (!leftTextLength) {
			// The left output run and all subsequent output runs are being erased.
			outputRuns.push(new OutputRun(erasureText));
		} else {
			// Some of the left output run is not being erased.
			const leftText = leftOutputRun.text.slice(0, leftTextLength);
			outputRuns.push(new OutputRun(
				leftText,
				leftOutputRun.sgrState,
				leftOutputRun.hyperlink
			));
			outputRuns.push(new OutputRun(erasureText));
		}

		// Splice the new output runs in.
		this.outputRuns.splice(
			leftOutputRunIndex,
			this._outputRuns.length - leftOutputRunIndex,
			...outputRuns
		);
	}

	/**
	 * Clears to the beginning of the output line.
	 * @param column The column at which to clear from.
	 */
	public clearToBeginningOfLine(column: number) {
		// Sanity check the column.
		column = Math.max(column, 0);

		// If there's nothing to clear, return.
		if (column === 0) {
			return;
		}

		// If the column is beyond the output runs, clear the entire line and return.
		if (column >= this._totalLength) {
			this.clearEntireLine();
			return;
		}

		// Find the right output run that is impacted.
		let rightOffset = 0;
		let rightOutputRun: OutputRun | undefined;
		let rightOutputRunIndex: number | undefined = undefined;
		for (let index = this._outputRuns.length - 1; index >= 0; index--) {
			// Get the output run.
			const outputRun = this._outputRuns[index];

			// If the column intersects with this output run, the right output run has been found.
			if (column >= rightOffset - outputRun.text.length) {
				rightOutputRun = outputRun;
				rightOutputRunIndex = index;
				break;
			}

			// Adjust the right output run offset.
			rightOffset -= outputRun.text.length;
		}

		// If the right output run wasn't found, there's an egregious bug in this code. Just return
		// in this case.
		if (rightOutputRun === undefined || rightOutputRunIndex === undefined) {
			return;
		}

		// Get the right text length.
		const rightTextLength = rightOffset - column;

		// Build the new output runs.
		const erasureText = ' '.repeat(column);
		const outputRuns = [new OutputRun(erasureText)];
		if (rightTextLength) {
			const rightOutputRunText = rightOutputRun.text.slice(-rightTextLength);
			outputRuns.push(new OutputRun(
				rightOutputRunText,
				rightOutputRun.sgrState,
				rightOutputRun.hyperlink
			));
		}

		// Splice the new output runs in.
		this.outputRuns.splice(
			0,
			this._outputRuns.length - rightOutputRunIndex,
			...outputRuns
		);
	}

	/**
	 * Inserts text into the output line.
	 * @param text The text to insert.
	 * @param column The column at which to insert the text.
	 * @param sgrState The SGR state.
	 * @param hyperlink The hyperlink.
	 */
	public insert(text: string, column: number, sgrState?: SGRState, hyperlink?: Hyperlink) {
		// If the text being inserted is empty, the insertion is complete.
		if (!text.length) {
			return;
		}

		// Optimize inserting text at the end of the output line.
		if (column === this._totalLength) {
			// Adjust the total length to account for the text being inserted.
			this._totalLength += text.length;

			// When possible, append the text being inserted to the last output run.
			if (this._outputRuns.length) {
				// Get the last output run. If we can append the text to it, do it.
				const lastOutputRun = this._outputRuns[this._outputRuns.length - 1];
				if (SGRState.equivalent(lastOutputRun.sgrState, sgrState) &&
					Hyperlink.equivalent(lastOutputRun.hyperlink, hyperlink)) {
					// Append the text to the last output run.
					lastOutputRun.appendText(text);

					// The insert is complete.
					return;
				}
			}

			// Append a new output run for the text being inserted.
			this._outputRuns.push(new OutputRun(text, sgrState, hyperlink));

			// The insert is complete.
			return;
		}

		// Optimize inserting text past the end of the output line
		if (column > this._totalLength) {
			// Create the spacer we need to insert.
			const spacer = ' '.repeat(column - this._totalLength);

			// Adjust the total length to account for the spacer and the text being inserted.
			this._totalLength += spacer.length + text.length;

			// When possible, append the text being inserted to the last output run.
			if (this._outputRuns.length) {
				// Get the last output run. If we can append the text to it, do it.
				const lastOutputRun = this._outputRuns[this._outputRuns.length - 1];
				if (SGRState.equivalent(lastOutputRun.sgrState, sgrState) &&
					Hyperlink.equivalent(lastOutputRun.hyperlink, hyperlink)) {
					// Append the text to the last output run.
					lastOutputRun.appendText(spacer + text);

					// The insert is complete.
					return;
				}
			}

			// Append a neutral output run for the spacer and an output run for the text being
			// inserted.
			this._outputRuns.push(new OutputRun(spacer));
			this._outputRuns.push(new OutputRun(text, sgrState, hyperlink));

			// The insert is complete.
			return;
		}

		// Find the left output run that is impacted by the insertion.
		let leftOffset = 0;
		let leftOutputRunIndex: number | undefined = undefined;
		for (let index = 0; index < this._outputRuns.length; index++) {
			// Get the output run.
			const outputRun = this._outputRuns[index];

			// If the column intersects with this output run, the left output run has been found.
			if (column < leftOffset + outputRun.text.length) {
				leftOutputRunIndex = index;
				break;
			}

			// Adjust the left output run offset.
			leftOffset += outputRun.text.length;
		}

		// If the left output run wasn't found, there's an egregious bug in this code.
		if (leftOutputRunIndex === undefined) {
			// Append a new output run for the text being inserted so it's not lost.
			this._outputRuns.push(new OutputRun(text, sgrState, hyperlink));

			// The insert is complete.
			return;
		}

		// If a right output run is not impacted, perform the insertion over the left output run.
		if (column + text.length >= this._totalLength) {
			// Get the left text length.
			const leftTextLength = column - leftOffset;

			// Build the new output runs.
			const outputRuns: OutputRun[] = [];
			if (!leftTextLength) {
				// The left output run is being completely overwritten so just add a new output run.
				outputRuns.push(new OutputRun(text, sgrState, hyperlink));
			} else {
				// Some of the left output run is not being overwritten.
				const leftOutputRun = this._outputRuns[leftOutputRunIndex];
				const leftText = leftOutputRun.text.slice(0, leftTextLength);

				// If the left output run has the same SGR state and hyperlink as the text being
				// inserted, we can just push a single output run with the left text and the text
				// being inserted. Otherwise, we need to push an output run for the left text and
				// an output run for the text being inserted.
				if (SGRState.equivalent(leftOutputRun.sgrState, sgrState) &&
					Hyperlink.equivalent(leftOutputRun.hyperlink, hyperlink)) {
					outputRuns.push(new OutputRun(leftText + text, sgrState, hyperlink));
				} else {
					// Push an output run for the left text.
					outputRuns.push(new OutputRun(
						leftText,
						leftOutputRun.sgrState,
						leftOutputRun.hyperlink
					));

					// Push an output run for the text being inserted.
					outputRuns.push(new OutputRun(
						text,
						sgrState,
						hyperlink
					));
				}
			}

			// Adjust the total length and splice the new output runs in.
			this._totalLength = leftOffset + leftTextLength + text.length;
			this.outputRuns.splice(leftOutputRunIndex, 1, ...outputRuns);

			// The insertion is complete.
			return;
		}

		// Find the right output run that is impacted by the insertion.
		let rightOffset = this._totalLength;
		let rightOutputRunIndex: number | undefined = undefined;
		for (let index = this._outputRuns.length - 1; index >= 0; index--) {
			// Get the output run.
			const outputRun = this._outputRuns[index];

			// If the column plus the text width intersects with this output run, the right output
			// run has been found.
			if (column + text.length > rightOffset - outputRun.text.length) {
				rightOutputRunIndex = index;
				break;
			}

			// Adjust the right output run offset.
			rightOffset -= outputRun.text.length;
		}

		// If the right output run wasn't found, there's an egregious bug in this code
		if (rightOutputRunIndex === undefined) {
			// Append a new output run for the text being inserted so it's not lost.
			this._outputRuns.push(new OutputRun(text, sgrState, hyperlink));

			// The insertion is complete.
			return;
		}

		// The output runs.
		const outputRuns: OutputRun[] = [];

		// Add the left output run, if needed.
		const leftOutputRunTextLength = column - leftOffset;
		if (leftOutputRunTextLength) {
			const leftOutputRun = this._outputRuns[leftOutputRunIndex];
			const leftOutputRunText = leftOutputRun.text.slice(0, leftOutputRunTextLength);
			outputRuns.push(new OutputRun(
				leftOutputRunText,
				leftOutputRun.sgrState,
				leftOutputRun.hyperlink
			));
		}

		// Add the new output run.
		outputRuns.push(new OutputRun(text, sgrState, hyperlink));

		// Add the right output run, if needed.
		const rightOutputRunTextLength = rightOffset - (column + text.length);
		if (rightOutputRunTextLength) {
			const rightOutputRun = this._outputRuns[rightOutputRunIndex];
			const rightOutputRunText = rightOutputRun.text.slice(-rightOutputRunTextLength);
			outputRuns.push(new OutputRun(
				rightOutputRunText,
				rightOutputRun.sgrState,
				rightOutputRun.hyperlink
			));
		}

		// Splice the new output runs into the output runs,
		this._outputRuns.splice(
			leftOutputRunIndex,
			(rightOutputRunIndex - leftOutputRunIndex) + 1,
			...outputRuns
		);

		// Optimize the output runs.
		if (this._outputRuns.length > 1) {
			this._outputRuns = OutputRun.optimizeOutputRuns(this._outputRuns);
		}

		// Recalculate the total length.
		this._totalLength = this._outputRuns.reduce((totalLength, outputRun) =>
			totalLength + outputRun.text.length,
			0
		);
	}

	//#endregion Public Methods

	//#region ANSIOutputLine Implementation

	/**
	 * Gets the identifier.
	 */
	public get id() {
		return this._id;
	}

	/**
	 * Gets the output runs.
	 */
	public get outputRuns(): ANSIOutputRun[] {
		return this._outputRuns;
	}

	//#endregion ANSIOutputLine Implementation
}

/**
 * OutputRun class.
 */
class OutputRun implements ANSIOutputRun {
	//#region Private Properties

	/**
	 * Gets the identifier.
	 */
	private _id = generateId();

	/**
	 * Gets the hyperlink.
	 */
	private readonly _hyperlink?: Hyperlink;

	/**
	 * Gets or sets the text.
	 */
	private _text: string;

	/**
	 * Gets the SGR state.
	 */
	private readonly _sgrState?: SGRState;

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the SGR state.
	 */
	get sgrState() {
		return this._sgrState;
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param text The text.
	 * @param sgrState The SGR state.
	 * @param hyperlink The hyperlink.
	 */
	constructor(text: string, sgrState?: SGRState, hyperlink?: Hyperlink) {
		this._text = text;
		this._sgrState = sgrState;
		this._hyperlink = hyperlink;
	}

	//#endregion Constructor

	//#region Public Static Methods

	/**
	 * Optimizes an array of output runs by combining adjacent output runs that can be combined.
	 * @param outputRuns The output runs to optimize.
	 * @returns The optimized output runs.
	 */
	public static optimizeOutputRuns(outputRuns: OutputRun[]) {
		// Build the optimized output runs by combining adjacent output runs that can be combined.
		const optimizedOutputRuns = [outputRuns[0]];
		for (let right = 1, left = 0; right < outputRuns.length; right++) {
			// Set the left and right output runs.
			const leftOutputRun = outputRuns[left];
			const rightOutputRun = outputRuns[right];

			// If left and right output runs have equivalent SGRStates and equivalent hyperlinks,
			// they can be combined. In this case, append the right output run's text to the left
			// output run's text. Otherwise, add the right output run to the optimized output runs.
			if (SGRState.equivalent(leftOutputRun.sgrState, rightOutputRun.sgrState) &&
				Hyperlink.equivalent(leftOutputRun.hyperlink, rightOutputRun.hyperlink)) {
				leftOutputRun._text += rightOutputRun._text;
			} else {
				optimizedOutputRuns[++left] = rightOutputRun;
			}
		}

		// Return the optimized output runs.
		return optimizedOutputRuns;
	}

	//#endregion Public Static Methods

	//#region Public Methods

	/**
	 * Appends text to the end of the output run.
	 * @param text The text to append.
	 */
	appendText(text: string) {
		this._text += text;
	}

	//#endregion Public Methods

	//#region ANSIOutputRun Implementation

	/**
	 * Gets the identifier.
	 */
	public get id() {
		return this._id;
	}

	/**
	 * Gets the hyperlink.
	 */
	get hyperlink() {
		return this._hyperlink;
	}

	/**
	 * Gets the format.
	 */
	public get format() {
		return this._sgrState;
	}

	/**
	 * Gets the text.
	 */
	public get text() {
		return this._text;
	}

	//#endregion ANSIOutputRun Implementation
}

/**
 * Hyperlink class.
 */
class Hyperlink implements ANSIHyperlink {
	//#region Public Properties

	/**
	 * Gets the params.
	 */
	public params?: Map<string, string>;

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param url The URL.
	 * @param params The params.
	 */
	constructor(public readonly url: string, params: string) {
		// If params were supplied, parse them.
		if (params) {
			// Split params and parse each of them.
			for (const param of params.split(':')) {
				// Match the param. If it is in key=value format, attempt to add it to the params.
				const match = param.match(/^(.+)=(.*)$/);
				if (match && match.length === 3) {
					// Trim the name. If it has a value, add the param.
					const name = match[1].trim();
					if (name) {
						// Trim the value.
						const value = match[2].trim();

						// Create the params, if we haven't done so yet.
						if (!this.params) {
							this.params = new Map<string, string>();
						}

						// Set the param.
						this.params.set(name, value);
					}
				}
			}
		}
	}

	//#endregion Constructor

	//#region Public Static Methods

	/**
	 * Determines whether two Hyperlinks are equivalent.
	 * @param hyperlink1 The 1st Hyperlink.
	 * @param hyperlink2 The 2nd Hyperlink.
	 * @returns A value which indicates whether the two Hyperlinks are equivalent.
	 */
	public static equivalent(hyperlink1?: Hyperlink, hyperlink2?: Hyperlink) {
		// Determines whether the two Hyperlinks are equivalent.
		return hyperlink1 === hyperlink2 || hyperlink1?.url === hyperlink2?.url;
	}

	//#endregion Public Static Methods
}

//#endregion Private Classes

//#region Helper Functions

/**
 * Generates an identifier.
 * @returns The identifier.
 */
const generateId = () => {
	return generateUuid();
};

/**
 * Gets and ranges a parameter value.
 * @param value The value.
 * @param defaultValue The default value.
 * @param minValue The minimum value.
 * @returns The ranged parameter value.
 */
const rangeParam = (value: string, defaultValue: number, minValue: number) => {
	const param = getParam(value, defaultValue);
	return Math.max(param, minValue);
};

/**
 * Gets a parameter value.
 * @param value The value.
 * @param defaultValue The default value.
 * @returns The parameter value.
 */
const getParam = (value: string, defaultValue: number) => {
	const param = parseInt(value);
	return Number.isNaN(param) ? defaultValue : param;
};

/**
 * Converts a number to a two-digit hex string representing the value.
 * @param value The value.
 * @returns A two digit hex string representing the value.
 */
const twoDigitHex = (value: number) => {
	// Return the value in hex format.
	const hex = Math.max(Math.min(255, value), 0).toString(16);
	return hex.length === 2 ? hex : '0' + hex;
};

//#endregion Helper Functions
