/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { SGRParam } from 'vs/base/common/ansi/ansiDefinitions';

/**
 * ParserState enumeration.
 */
enum ParserState {
	BufferingOutput,
	ControlSequenceStarted,
	ParsingControlSequence
}

class SGRState {
	/**
	 * Gets or sets the SGR params.
	 */
	public sgrParams: SGRParam[] = [];

	/**
	 * Gets or sets the SGR custom foreground color (in the form #rrggbbaa).
	 */
	public sgrCustomForegroundColor: string | undefined = undefined;

	/**
	 * Gets or sets the SGR custom background color (in the form #rrggbbaa).
	 */
	public sgrCustomBackgroundColor: string | undefined = undefined;

	/**
	 * Gets or sets the SGR custom underlined color (in the form #rrggbbaa).
	 */
	public sgrCustomUnderlinedColor: string | undefined = undefined;

	/**
	 * Gets or sets a value which indicates whether the SGR foreground and
	 * background colors are reversed.
	 */
	public sgrReversed = false;

	static equals(a: SGRState, b: SGRState): boolean {

		if (a.sgrParams.length !== b.sgrParams.length) {
			return false;
		}

		for (let i = 0; i < a.sgrParams.length; i++) {
			if (a.sgrParams[i] !== b.sgrParams[i]) {
				return false;
			}
		}

		if (a.sgrCustomForegroundColor !== b.sgrCustomForegroundColor) {
			return false;
		}

		if (a.sgrCustomBackgroundColor !== b.sgrCustomBackgroundColor) {
			return false;
		}

		if (a.sgrCustomUnderlinedColor !== b.sgrCustomUnderlinedColor) {
			return false;
		}

		if (a.sgrReversed !== b.sgrReversed) {
			return false;
		}

		return true;
	}
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

	private sgrState = new SGRState();

	// /**
	//  * Gets or sets the SGR params.
	//  */
	// private sgrParams: SGRParam[] = [];

	// /**
	//  * Gets or sets the SGR custom foreground color (in the form #rrggbbaa).
	//  */
	// private sgrCustomForegroundColor: string | undefined;

	// /**
	//  * Gets or sets the SGR custom background color (in the form #rrggbbaa).
	//  */
	// private sgrCustomBackgroundColor: string | undefined;

	// /**
	//  * Gets or sets the SGR custom underlined color (in the form #rrggbbaa).
	//  */
	// private sgrCustomUnderlinedColor: string | undefined;

	// /**
	//  * Gets or sets a value which indicates whether the SGR foreground and
	//  * background colors are reversed.
	//  */
	// private sgrReversed = false;

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
					// We encountered an ESC that is not part of a CSI.
					// Ignore the ESC, go back to the buffering output
					// state, and process the character.
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
		// Flush the current buffer.
		this.flushBuffer();

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
			customForegroundColor: this.sgrState.sgrCustomForegroundColor,
			customBackgroundColor: this.sgrState.sgrCustomBackgroundColor,
			customUnderlinedColor: this.sgrState.sgrCustomUnderlinedColor,
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
			.slice(0, -1)	// Remove ending m.
			.split(';')
			.map(sgrParam => sgrParam === '' ? SGRParam.Reset : parseInt(sgrParam, 10));

		// Process the SGR parameters.
		for (let i = 0; i < sgrParams.length; i++) {
			// Get the SGR parameter.
			const sgrParam = sgrParams[i];

			// Process the SGR parameter.
			switch (sgrParam) {
				case SGRParam.Reset:
					this.resetSGR();
					break;

				case SGRParam.Bold:
					this.updateSGRParams(sgrParam);
					break;

				case SGRParam.Dim:
					this.updateSGRParams(sgrParam);
					break;

				case SGRParam.Italic:
					this.updateSGRParams(sgrParam);
					break;

				case SGRParam.Underlined:
					this.updateSGRParams(sgrParam, SGRParam.DoubleUnderlined);
					break;

				case SGRParam.SlowBlink:
					this.updateSGRParams(sgrParam, SGRParam.RapidBlink);
					break;

				case SGRParam.RapidBlink:
					this.updateSGRParams(sgrParam, SGRParam.SlowBlink);
					break;

				case SGRParam.Reversed:
					if (!this.sgrState.sgrReversed) {
						this.sgrState.sgrReversed = true;
						// reverseForegroundAndBackgroundColors()
					}
					break;

				case SGRParam.Hidden:
					this.updateSGRParams(sgrParam);
					break;

				case SGRParam.CrossedOut:
					this.updateSGRParams(sgrParam);
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
				case SGRParam.Fraktur:
					// Do nothing for now.
					break;

				case SGRParam.DoubleUnderlined:
					this.updateSGRParams(sgrParam, SGRParam.Underlined);
					break;

				case SGRParam.NormalIntensity:
					this.clearSGRParams(SGRParam.Bold, SGRParam.Dim);
					break;

				case SGRParam.NotItalicNotFraktur:
					this.clearSGRParams(SGRParam.Italic);
					break;

				case SGRParam.NotUnderlined:
					this.clearSGRParams(SGRParam.Underlined, SGRParam.DoubleUnderlined);
					break;

				case SGRParam.NotBlinking:
					this.clearSGRParams(SGRParam.SlowBlink, SGRParam.RapidBlink);
					break;

				case SGRParam.ProportionalSpacing:
					// Do nothing for now.
					break;

				case SGRParam.NotReversed:
					if (this.sgrState.sgrReversed) {
						this.sgrState.sgrReversed = false;
						// reverseForegroundAndBackgroundColors()
					}
					break;

				case SGRParam.Reveal:
					this.clearSGRParams(SGRParam.Hidden);
					break;

				case SGRParam.NotCrossedOut:
					this.clearSGRParams(SGRParam.CrossedOut);
					break;

				case SGRParam.ForegroundBlack:
				case SGRParam.ForegroundRed:
				case SGRParam.ForegroundGreen:
				case SGRParam.ForegroundYellow:
				case SGRParam.ForegroundBlue:
				case SGRParam.ForegroundMagenta:
				case SGRParam.ForegroundCyan:
				case SGRParam.ForegroundWhite:
					this.clearForegroundSGRParams();
					this.sgrState.sgrParams.push(sgrParam);
					break;

				case SGRParam.SetForeground:
					// Get the 3 bit or 24 bit color.
					break;

				case SGRParam.DefaultForeground:
					break;

				case SGRParam.BackgroundBlack:
				case SGRParam.BackgroundRed:
				case SGRParam.BackgroundGreen:
				case SGRParam.BackgroundYellow:
				case SGRParam.BackgroundBlue:
				case SGRParam.BackgroundMagenta:
				case SGRParam.BackgroundCyan:
				case SGRParam.BackgroundWhite:
					this.clearBackgroundSGRParams();
					this.sgrState.sgrParams.push(sgrParam);
					break;

				case SGRParam.ForegroundBrightBlack:
				case SGRParam.ForegroundBrightRed:
				case SGRParam.ForegroundBrightGreen:
				case SGRParam.ForegroundBrightYellow:
				case SGRParam.ForegroundBrightBlue:
				case SGRParam.ForegroundBrightMagenta:
				case SGRParam.ForegroundBrightCyan:
				case SGRParam.ForegroundBrightWhite:
					this.clearForegroundSGRParams();
					this.sgrState.sgrParams.push(sgrParam);
					break;


				case SGRParam.BackgroundBrightBlack:
				case SGRParam.BackgroundBrightRed:
				case SGRParam.BackgroundBrightGreen:
				case SGRParam.BackgroundBrightYellow:
				case SGRParam.BackgroundBrightBlue:
				case SGRParam.BackgroundBrightMagenta:
				case SGRParam.BackgroundBrightCyan:
				case SGRParam.BackgroundBrightWhite:
					this.clearBackgroundSGRParams();
					this.sgrState.sgrParams.push(sgrParam);
					break;
			}
		}
	}

	private resetSGR() {
		this.sgrState = new SGRState();
	}

	/**
	 * Updates SGR params.
	 * @param sgrParam The SGR param to set.
	 * @param sgrParamsToClear The SGR params to clear.
	 */
	private updateSGRParams(sgrParam: SGRParam, ...sgrParamsToClear: SGRParam[]) {
		// Clear SGR params.
		this.clearSGRParams(sgrParam, ...sgrParamsToClear);

		// Set the SGR param.
		this.sgrState.sgrParams.push(sgrParam);
	}

	/**
	 * Clears SGR params.
	 * @param sgrParamsToClear
	 */
	private clearSGRParams(...sgrParamsToClear: SGRParam[]) {
		this.sgrState.sgrParams = this.sgrState.sgrParams.filter(sgrParam => !sgrParamsToClear.includes(sgrParam));
	}

	/**
	 * Clears any foreground SGR params.
	 */
	private clearForegroundSGRParams() {
		this.sgrState.sgrParams = this.sgrState.sgrParams.filter(sgrParam =>
			!(sgrParam >= SGRParam.ForegroundBlack && sgrParam <= SGRParam.ForegroundWhite) &&
			!(sgrParam >= SGRParam.ForegroundBrightBlack && sgrParam <= SGRParam.ForegroundBrightWhite)
		);
	}

	/**
	 * Clears any background SGR params.
	 */
	private clearBackgroundSGRParams() {
		this.sgrState.sgrParams = this.sgrState.sgrParams.filter(sgr =>
			!(sgr >= SGRParam.BackgroundBlack && sgr <= SGRParam.BackgroundWhite) &&
			!(sgr >= SGRParam.BackgroundBrightBlack && sgr <= SGRParam.BackgroundBrightWhite)
		);
	}

	//#endregion Private Methods
}
