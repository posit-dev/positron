/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import * as positron from 'positron';
import { makeCUB, makeCUF, makeCUP, makeED, makeEL, makeSGR, SGR } from './ansi';
import * as ansi from 'ansi-escape-sequences';
import { resolve } from 'path';
import { ZedEnvironment } from './positronZedEnvironment';

/**
 * Constants.
 */
const ESC = '\x1b';
const CSI = ESC + '[';
//const CSI = '\x9B';

const TEN_SPACES = '          ';
const TEN_BLOCKS = '\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588';
const FIVE_SPACES = '     ';
const FIVE_BLOCKS = '\u2588\u2588\u2588\u2588\u2588';
const CONTRAST_FOREGROUND = '  Contrast Foreground  ';

/**
 * The help lines.
 */
const HelpLines = [
	'Zed help:',
	'',
	'1k           - Inserts 1,000 lines of ANSI output',
	'ansi 16      - Displays standard ANSI colors as foreground and background colors',
	'ansi 256     - Displays indexed ANSI colors as foreground and background colors',
	'ansi blink   - Displays blinking output',
	'ansi cub     - Outputs text using CUB',
	'ansi cuf     - Outputs text using CUF',
	'ansi cup     - Outputs text using CUP',
	'ansi ed 0    - Clears to the end of the screen using ED',
	'ansi ed 1    - Clears to the beginning of the screen using ED',
	'ansi ed 2    - Clears an entire screen using ED',
	'ansi el 0    - Clears to the end of the line using EL',
	'ansi el 1    - Clears to the beginning of the line using EL',
	'ansi el 2    - Clears an entire line using EL',
	'ansi hidden  - Displays hidden text',
	'ansi rgb     - Displays RGB ANSI colors as foreground and background colors',
	'code X Y     - Simulates a successful X line input with Y lines of output (where X >= 1 and Y >= 0)',
	'env clear    - Clears all variables from the environment',
	'env def X    - Defines X variables (randomly typed)',
	'env def X Y  - Defines X variables of type Y, where Y is one of: string, number, vector, or blob',
	'env rm X     - Removes X variables',
	'env update X - Updates X variables',
	'error X Y Z  - Simulates an unsuccessful X line input with Y lines of error message and Z lines of traceback (where X >= 1 and Y >= 1 and Z >= 0)',
	'help         - Shows this help',
	'offline      - Simulates going offline for two seconds',
	'progress     - Renders a progress bar',
	'shutdown     - Simulates orderly shutdown',
	'version      - Shows the Zed version'
].join('\n');

/**
 * Returns a right-aligned three digit decimal value.
 * @param value The value (must be between 0 and 255).
 * @returns The right-right-aligned three digit decimal value such that:
 *   1 = '   1 ' and
 * 255 = ' 255 '.
 */
const rightAlignedThreeDigitDecimal = (value: number) => {
	if (value < 0 && value > 255) {
		return ' ??? ';
	} else {
		// Return the value right aligned to three places.
		const decimal = value.toString(10);
		if (decimal.length === 1) {
			return `   ${decimal} `;
		} else if (decimal.length === 2) {
			return `  ${decimal} `;
		} else {
			return ` ${decimal} `;
		}
	}
};

/**
 * PositronZedLanguageRuntime.
 */
export class PositronZedLanguageRuntime implements positron.LanguageRuntime {
	//#region Private Properties

	/**
	 * The onDidReceiveRuntimeMessage event emitter.
	 */
	private readonly _onDidReceiveRuntimeMessage = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();

	/**
	 * The onDidChangeRuntimeState event emitter.
	 */
	private readonly _onDidChangeRuntimeState = new vscode.EventEmitter<positron.RuntimeState>();

	/**
	 * A history of executed commands
	 */
	private readonly _history: string[][] = [];

	/*
	 * A map of environment IDs to environment instances.
	 */
	private readonly _environments: Map<string, ZedEnvironment> = new Map();

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param runtimeId The ID for the new runtime
	 * @param version The language version.
	 */
	constructor(runtimeId: string, version: string) {
		this.metadata = {
			runtimeId,
			languageId: 'zed',
			languageName: 'Zed',
			runtimeName: 'Zed',
			languageVersion: version,
			runtimeVersion: '0.0.1',
			startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit
		};
	}

	//#endregion Constructor

	//#region LanguageRuntime Implementation

	/**
	 * Gets the metadata for the language runtime.
	 */
	readonly metadata: positron.LanguageRuntimeMetadata;

	/**
	 * An object that emits language runtime events.
	 */
	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage> = this._onDidReceiveRuntimeMessage.event;

	/**
	 * An object that emits he current state of the runtime.
	 */
	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState> = this._onDidChangeRuntimeState.event;

	/**
	 * Execute code in the runtime.
	 * @param code The code to exeucte.
	 * @param id The ID of the operation.
	 * @param mode The execution mode to conform to.
	 * @param errorBehavior The error behavior to conform to.
	 */
	execute(code: string, id: string, mode: positron.RuntimeCodeExecutionMode, errorBehavior: positron.RuntimeErrorBehavior): void {
		// Trim the code.
		code = code.trim();

		// Check for commands by regex.
		let match;
		if (match = code.match(/^code ([1-9]{1}[\d]*) ([\d]+)$/)) {
			// Build the code.
			let code = '';
			for (let i = 1; i <= +match[1]; i++) {
				code += `Code line ${i}\n`;
			}

			// Build the output.
			const output = '';
			for (let i = 1; i <= +match[2]; i++) {
				code += `Output line ${i}\n`;
			}

			// Simulate successful code execution.
			return this.simulateSuccessfulCodeExecution(id, code, output);
		} else if (match = code.match(/^error ([1-9]{1}[\d]*) ([1-9]{1}[\d]*) ([\d]+)$/)) {
			// Build the code.
			let code = '';
			for (let i = 1; i <= +match[1]; i++) {
				code += `Code line ${i}\n`;
			}

			// Build the message.
			let message = '';
			for (let i = 1; i <= +match[2]; i++) {
				message += `Error message line ${i}\n`;
			}

			// Build the traceback.
			const traceback: string[] = [];
			for (let i = 1; i <= +match[3]; i++) {
				traceback.push(`Traceback line ${i}`);
			}

			// Simulate unsuccessful code execution.
			return this.simulateUnsuccessfulCodeExecution(id, code, 'Simulated Error', message, traceback);
		} else if (match = code.match(/^env def ([1-9]{1}[\d]*) ?(.*)/)) {
			// Define the value in each environment; there's probably only one, but one can't be
			// too careful about these things. In the future, we'll probably want to be able to
			// define variables in specific environments or nest environments.
			const count = +match[1];
			const kind = match[2];
			if (this._environments.size > 0) {
				for (const environment of this._environments.values()) {
					environment.defineVars(count, kind);
				}
				if (kind) {
					return this.simulateSuccessfulCodeExecution(id, code,
						`Defined ${count} '${kind}' variables.`);
				} else {
					return this.simulateSuccessfulCodeExecution(id, code,
						`Defined ${count} variables.`);
				}

			} else {
				// This could happen if we try to define variables but there's no backend in which
				// to define them.
				return this.simulateUnsuccessfulCodeExecution(id, code,
					'No Environments',
					'No environments are available to define variables in.', []);
			}
		} else if (match = code.match(/^env update ([1-9]{1}[\d]*)/)) {
			let count = +match[1];
			if (this._environments.size > 0) {
				for (const environment of this._environments.values()) {
					count = environment.updateVars(count);
				}
			}
			return this.simulateSuccessfulCodeExecution(id, code,
				`Updated the values of ${count} variables.`);
		} else if (match = code.match(/^env rm ([1-9]{1}[\d]*)/)) {
			let count = +match[1];
			if (this._environments.size > 0) {
				for (const environment of this._environments.values()) {
					count = environment.removeVars(count);
				}
			}
			return this.simulateSuccessfulCodeExecution(id, code,
				`Removed ${count} variables.`);
		}

		// Process the "code".
		switch (code) {
			case '': {
				this.simulateSuccessfulCodeExecution(id, code);
				break;
			}

			case '1k': {
				this.simulateBusyState(id);
				this.simulateInputMessage(id, code);
				for (let i = 1; i <= 1000; i++) {
					this.simulateOutputMessage(id, `${makeSGR(SGR.ForegroundRed)}This is line${makeSGR()} ${makeSGR(SGR.ForegroundGreen)}${i}${makeSGR()}\n`);
				}
				this.simulateIdleState(id);
				break;
			}

			case 'ansi 16': {
				this.simulateSuccessfulCodeExecution(
					id,
					code,
					`Standard ANSI foreground colors:\n` +
					`${makeSGR(SGR.ForegroundBlack)}${TEN_BLOCKS}${makeSGR()} Black foreground\n` +
					`${makeSGR(SGR.ForegroundRed)}${TEN_BLOCKS}${makeSGR()} Red foreground\n` +
					`${makeSGR(SGR.ForegroundGreen)}${TEN_BLOCKS}${makeSGR()} Green foreground\n` +
					`${makeSGR(SGR.ForegroundYellow)}${TEN_BLOCKS}${makeSGR()} Yellow foreground\n` +
					`${makeSGR(SGR.ForegroundBlue)}${TEN_BLOCKS}${makeSGR()} Blue foreground\n` +
					`${makeSGR(SGR.ForegroundMagenta)}${TEN_BLOCKS}${makeSGR()} Magenta foreground\n` +
					`${makeSGR(SGR.ForegroundCyan)}${TEN_BLOCKS}${makeSGR()} Cyan foreground\n` +
					`${makeSGR(SGR.ForegroundWhite)}${TEN_BLOCKS}${makeSGR()} White foreground\n` +

					`\nBright ANSI foreground colors:\n` +
					`${makeSGR(SGR.ForegroundBrightBlack)}${TEN_BLOCKS}${makeSGR()} Bright black foreground\n` +
					`${makeSGR(SGR.ForegroundBrightRed)}${TEN_BLOCKS}${makeSGR()} Bright red foreground\n` +
					`${makeSGR(SGR.ForegroundBrightGreen)}${TEN_BLOCKS}${makeSGR()} Bright green foreground\n` +
					`${makeSGR(SGR.ForegroundBrightYellow)}${TEN_BLOCKS}${makeSGR()} Bright yellow foreground \n` +
					`${makeSGR(SGR.ForegroundBrightBlue)}${TEN_BLOCKS}${makeSGR()} Bright blue foreground\n` +
					`${makeSGR(SGR.ForegroundBrightMagenta)}${TEN_BLOCKS}${makeSGR()} Bright magenta foreground\n` +
					`${makeSGR(SGR.ForegroundBrightCyan)}${TEN_BLOCKS}${makeSGR()} Bright cyan foreground\n` +
					`${makeSGR(SGR.ForegroundBrightWhite)}${TEN_BLOCKS}${makeSGR()} Bright white foreground\n` +

					`\nStandard ANSI background colors:\n` +
					`${makeSGR(SGR.BackgroundBlack)}${TEN_SPACES}${makeSGR()} Black background\n` +
					`${makeSGR(SGR.BackgroundRed)}${TEN_SPACES}${makeSGR()} Red background\n` +
					`${makeSGR(SGR.BackgroundGreen)}${TEN_SPACES}${makeSGR()} Green background\n` +
					`${makeSGR(SGR.BackgroundYellow)}${TEN_SPACES}${makeSGR()} Yellow background\n` +
					`${makeSGR(SGR.BackgroundBlue)}${TEN_SPACES}${makeSGR()} Blue background\n` +
					`${makeSGR(SGR.BackgroundMagenta)}${TEN_SPACES}${makeSGR()} Magenta background\n` +
					`${makeSGR(SGR.BackgroundCyan)}${TEN_SPACES}${makeSGR()} Cyan background\n` +
					`${makeSGR(SGR.BackgroundWhite)}${TEN_SPACES}${makeSGR()} White background\n` +

					`\nBright ANSI background colors:\n` +
					`${makeSGR(SGR.BackgroundBrightBlack)}${TEN_SPACES}${makeSGR()} Bright black background\n` +
					`${makeSGR(SGR.BackgroundBrightRed)}${TEN_SPACES}${makeSGR()} Bright red background\n` +
					`${makeSGR(SGR.BackgroundBrightGreen)}${TEN_SPACES}${makeSGR()} Bright green background\n` +
					`${makeSGR(SGR.BackgroundBrightYellow)}${TEN_SPACES}${makeSGR()} Bright yellow background\n` +
					`${makeSGR(SGR.BackgroundBrightBlue)}${TEN_SPACES}${makeSGR()} Bright blue background\n` +
					`${makeSGR(SGR.BackgroundBrightMagenta)}${TEN_SPACES}${makeSGR()} Bright magenta background\n` +
					`${makeSGR(SGR.BackgroundBrightCyan)}${TEN_SPACES}${makeSGR()} Bright cyan background\n` +
					`${makeSGR(SGR.BackgroundBrightWhite)}${TEN_SPACES}${makeSGR()} Bright white background\n` +

					`\nStandard ANSI background colors with automatically contrasting foreground colors:\n` +
					`${makeSGR(SGR.BackgroundBlack)}${CONTRAST_FOREGROUND}${makeSGR()} Black background\n` +
					`${makeSGR(SGR.BackgroundRed)}${CONTRAST_FOREGROUND}${makeSGR()} Red background\n` +
					`${makeSGR(SGR.BackgroundGreen)}${CONTRAST_FOREGROUND}${makeSGR()} Green background\n` +
					`${makeSGR(SGR.BackgroundYellow)}${CONTRAST_FOREGROUND}${makeSGR()} Yellow background\n` +
					`${makeSGR(SGR.BackgroundBlue)}${CONTRAST_FOREGROUND}${makeSGR()} Blue background\n` +
					`${makeSGR(SGR.BackgroundMagenta)}${CONTRAST_FOREGROUND}${makeSGR()} Magenta background\n` +
					`${makeSGR(SGR.BackgroundCyan)}${CONTRAST_FOREGROUND}${makeSGR()} Cyan background\n` +
					`${makeSGR(SGR.BackgroundWhite)}${CONTRAST_FOREGROUND}${makeSGR()} White background\n` +

					`\nBright ANSI background colors with automatically contrasting foreground colors:\n` +
					`${makeSGR(SGR.BackgroundBrightBlack)}${CONTRAST_FOREGROUND}${makeSGR()} Bright black background\n` +
					`${makeSGR(SGR.BackgroundBrightRed)}${CONTRAST_FOREGROUND}${makeSGR()} Bright red background\n` +
					`${makeSGR(SGR.BackgroundBrightGreen)}${CONTRAST_FOREGROUND}${makeSGR()} Bright green background\n` +
					`${makeSGR(SGR.BackgroundBrightYellow)}${CONTRAST_FOREGROUND}${makeSGR()} Bright yellow background\n` +
					`${makeSGR(SGR.BackgroundBrightBlue)}${CONTRAST_FOREGROUND}${makeSGR()} Bright blue background\n` +
					`${makeSGR(SGR.BackgroundBrightMagenta)}${CONTRAST_FOREGROUND}${makeSGR()} Bright magenta background\n` +
					`${makeSGR(SGR.BackgroundBrightCyan)}${CONTRAST_FOREGROUND}${makeSGR()} Bright cyan background\n` +
					`${makeSGR(SGR.BackgroundBrightWhite)}${CONTRAST_FOREGROUND}${makeSGR()} Bright white background\n`
				);
				break;
			}

			case 'ansi 256': {
				let output = 'Foreground colors:\n';
				for (let i = 0; i < 16; i++) {
					for (let j = 0; j < 16; j++) {
						const colorIndex = i * 16 + j;
						output += `${rightAlignedThreeDigitDecimal(colorIndex)} `;
					}
					output += '\n';
					for (let j = 0; j < 16; j++) {
						const colorIndex = i * 16 + j;
						output += `${makeSGR(SGR.SetForeground, 5, colorIndex)}${FIVE_BLOCKS}${makeSGR()} `;
					}
					output += '\n';
				}

				output += '\nBackground colors:\n';

				for (let i = 0; i < 16; i++) {
					for (let j = 0; j < 16; j++) {
						const colorIndex = i * 16 + j;
						output += `${rightAlignedThreeDigitDecimal(colorIndex)} `;
					}
					output += '\n';
					for (let j = 0; j < 16; j++) {
						const colorIndex = i * 16 + j;
						output += `${makeSGR(SGR.SetBackground, 5, colorIndex)}${FIVE_SPACES}${makeSGR()} `;
					}
					output += '\n';
				}
				this.simulateSuccessfulCodeExecution(id, code, output);
				break;
			}

			case 'ansi blink': {
				this.simulateSuccessfulCodeExecution(
					id,
					code,
					`${makeSGR(SGR.BackgroundRed, SGR.ForegroundWhite, SGR.SlowBlink)}  This is blinking text  ${makeSGR()} Slowly Blinking\n` +
					`${makeSGR(SGR.BackgroundRed, SGR.ForegroundWhite, SGR.RapidBlink)}  This is blinking text  ${makeSGR()} Rapidly Blinking\n`
				);
				break;
			}

			case 'ansi cub': {
				this.simulateSuccessfulCodeExecution(
					id,
					code,
					'Ten \u2588 characters separated by one space using CUB (Cursor Backward):\n' +
					'0 1 2 3 4 5 6 7 8 9\n' +
					`\u2588${makeCUB()}\u2588 ` +
					`\u2588${makeCUB()}\u2588 ` +
					`\u2588${makeCUB()}\u2588 ` +
					`\u2588${makeCUB()}\u2588 ` +
					`\u2588${makeCUB()}\u2588 ` +
					`\u2588${makeCUB()}\u2588 ` +
					`\u2588${makeCUB()}\u2588 ` +
					`\u2588${makeCUB()}\u2588 ` +
					`\u2588${makeCUB()}\u2588 ` +
					`\u2588${makeCUB()}\u2588\n` +
					'\nTen \u2588 characters separated by two space using CUB (Cursor Backward):\n' +
					'0  1  2  3  4  5  6  7  8  9\n' +
					`\u2588  ${makeCUB(3)}\u2588  ` +
					`\u2588  ${makeCUB(3)}\u2588  ` +
					`\u2588  ${makeCUB(3)}\u2588  ` +
					`\u2588  ${makeCUB(3)}\u2588  ` +
					`\u2588  ${makeCUB(3)}\u2588  ` +
					`\u2588  ${makeCUB(3)}\u2588  ` +
					`\u2588  ${makeCUB(3)}\u2588  ` +
					`\u2588  ${makeCUB(3)}\u2588  ` +
					`\u2588  ${makeCUB(3)}\u2588  ` +
					`\u2588  ${makeCUB(3)}\u2588\n\n` +

					'These should match:\n' +
					`${makeSGR(SGR.ForegroundRed)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundWhite)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundBlue)}0123456789${makeSGR()}\n` +

					`${makeSGR(SGR.ForegroundRed)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundGreen)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundBlue)}0123456789${makeSGR()}` +
					`${makeCUB(20)}` +
					`${makeSGR(SGR.ForegroundWhite)}0123456789${makeSGR()}\n\n` +

					'These should match:\n' +
					`${makeSGR(SGR.ForegroundRed)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundWhite)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundWhite)}01234${makeSGR()}` +
					`${makeSGR(SGR.ForegroundBlue)}56789${makeSGR()}\n` +

					`${makeSGR(SGR.ForegroundRed)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundGreen)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundBlue)}0123456789${makeSGR()}` +
					`${makeCUB(20)}` +
					`${makeSGR(SGR.ForegroundWhite)}012345678901234${makeSGR()}\n\n` +

					'These should match:\n' +
					`${makeSGR(SGR.ForegroundRed)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundWhite)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundBlue)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundGreen)}0123456789${makeSGR()}\n` +

					`${makeSGR(SGR.ForegroundRed)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundGreen)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundBlue)}0123456789${makeSGR()}` +

					`${makeCUB(20)}` +
					`${makeSGR(SGR.ForegroundWhite)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundBlue)}0123456789${makeSGR()}` +
					`${makeSGR(SGR.ForegroundGreen)}0123456789${makeSGR()}`
				);
				break;
			}

			case 'ansi cuf': {
				this.simulateSuccessfulCodeExecution(
					id,
					code,
					'Ten \u2588 characters separated by one space using CUF (Cursor Forward):\n' +
					'0 1 2 3 4 5 6 7 8 9\n' +
					`\u2588${makeCUF()}` +
					`\u2588${makeCUF()}` +
					`\u2588${makeCUF()}` +
					`\u2588${makeCUF()}` +
					`\u2588${makeCUF()}` +
					`\u2588${makeCUF()}` +
					`\u2588${makeCUF()}` +
					`\u2588${makeCUF()}` +
					`\u2588${makeCUF()}` +
					`\u2588${makeCUF()}\n` +
					'\nTen \u2588 characters separated by two spaces using CUF (Cursor Forward):\n' +
					'0  1  2  3  4  5  6  7  8  9\n' +
					`\u2588${makeCUF(2)}` +
					`\u2588${makeCUF(2)}` +
					`\u2588${makeCUF(2)}` +
					`\u2588${makeCUF(2)}` +
					`\u2588${makeCUF(2)}` +
					`\u2588${makeCUF(2)}` +
					`\u2588${makeCUF(2)}` +
					`\u2588${makeCUF(2)}` +
					`\u2588${makeCUF(2)}` +
					`\u2588${makeCUF(2)}\n` +
					'\nTen \u2588 characters separated by four spaces using CUF (Cursor Forward):\n' +
					'0    1    2    3    4    5    6    7    8    9\n' +
					`\u2588${makeCUF(4)}` +
					`\u2588${makeCUF(4)}` +
					`\u2588${makeCUF(4)}` +
					`\u2588${makeCUF(4)}` +
					`\u2588${makeCUF(4)}` +
					`\u2588${makeCUF(4)}` +
					`\u2588${makeCUF(4)}` +
					`\u2588${makeCUF(4)}` +
					`\u2588${makeCUF(4)}` +
					`\u2588${makeCUF(4)}\n`

				);
				break;
			}

			case 'ansi cup': {
				this.simulateSuccessfulCodeExecution(
					id,
					code,
					`THIS IS LINE 1\n` +
					`THIS IS LINE 2\n` +
					`THIS IS LINE 3\n` +
					`THIS IS LINE 4` +
					`${makeCUP()}` +
					`This is line 1\n` +
					`This is line 2\n` +
					`This is line 3\n` +
					`This is line 4`
				);
				break;
			}

			case 'ansi ed 0': {
				const line = '0123456789'.repeat(8);
				this.simulateSuccessfulCodeExecution(
					id,
					code,
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line +
					makeCUP(5, 1) +
					makeED('beginning-of-screen')
				);
				break;
			}

			case 'ansi ed 1': {
				const line = '0123456789'.repeat(8);
				this.simulateSuccessfulCodeExecution(
					id,
					code,
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line +
					makeCUP(5, 1) +
					makeED('end-of-screen')
				);
				break;
			}

			case 'ansi ed 2': {
				const line = '0123456789'.repeat(8);
				this.simulateSuccessfulCodeExecution(
					id,
					code,
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line + '\n' +
					line +
					makeCUP() +
					makeED('end-of-screen')
				);
				break;
			}

			case 'ansi el 0': {
				this.simulateSuccessfulCodeExecution(
					id,
					code,
					'40 spaces at the end of the line using CUP and EL:\n' +
					'0123456789'.repeat(8) + '\n' +
					'0123456789'.repeat(8) + makeCUP(3, 41) + makeEL('end-of-line')
				);
				break;
			}

			case 'ansi el 1': {
				this.simulateSuccessfulCodeExecution(
					id,
					code,
					'40 spaces at the end of the line using CUP and EL:\n' +
					'0123456789'.repeat(8) + '\n' +
					'0123456789'.repeat(8) + makeCUP(3, 41) + makeEL('beginning-of-line')
				);
				break;
			}

			case 'ansi el 2': {
				this.simulateSuccessfulCodeExecution(
					id,
					code,
					'80 \u2588 characters using EL and CUB:\n' +
					'0123456789'.repeat(8) + '\n' +
					'0123456789'.repeat(8) + makeEL('entire-line') + makeCUP(3) + '\u2588'.repeat(80)
				);
				break;
			}

			case 'ansi hidden': {
				this.simulateSuccessfulCodeExecution(
					id,
					code,
					`There is ${makeSGR(SGR.Italic)}hidden text${makeSGR(SGR.NotItalicNotFraktur)} between the square brackets -> [${makeSGR(SGR.Hidden)}THIS SHOULD BE HIDDEN!${makeSGR(SGR.Reveal)}]`
				);
				break;
			}

			case 'ansi rgb': {
				this.simulateSuccessfulCodeExecution(
					id,
					code,
					`${makeSGR(SGR.SetForeground, 2, 0xdd, 0x00, 0x00)}${TEN_BLOCKS}${makeSGR()} Red Foreground\n` +
					`${makeSGR(SGR.SetForeground, 2, 0xfe, 0x62, 0x30)}${TEN_BLOCKS}${makeSGR()} Orange Foreground\n` +
					`${makeSGR(SGR.SetForeground, 2, 0xfe, 0xf6, 0x00)}${TEN_BLOCKS}${makeSGR()} Yellow Foreground\n` +
					`${makeSGR(SGR.SetForeground, 2, 0x00, 0xbb, 0x00)}${TEN_BLOCKS}${makeSGR()} Green Foreground\n` +
					`${makeSGR(SGR.SetForeground, 2, 0x00, 0x9b, 0xfe)}${TEN_BLOCKS}${makeSGR()} Blue Foreground\n` +
					`${makeSGR(SGR.SetForeground, 2, 0x00, 0x00, 0x83)}${TEN_BLOCKS}${makeSGR()} Indigo Foreground\n` +
					`${makeSGR(SGR.SetForeground, 2, 0x30, 0x00, 0x9b)}${TEN_BLOCKS}${makeSGR()} Violet Foreground\n` +
					`${makeSGR(SGR.SetBackground, 2, 0xdd, 0x00, 0x00)}${TEN_SPACES}${makeSGR()} Red Background\n` +
					`${makeSGR(SGR.SetBackground, 2, 0xfe, 0x62, 0x30)}${TEN_SPACES}${makeSGR()} Orange Background\n` +
					`${makeSGR(SGR.SetBackground, 2, 0xfe, 0xf6, 0x00)}${TEN_SPACES}${makeSGR()} Yellow Background\n` +
					`${makeSGR(SGR.SetBackground, 2, 0x00, 0xbb, 0x00)}${TEN_SPACES}${makeSGR()} Green Background\n` +
					`${makeSGR(SGR.SetBackground, 2, 0x00, 0x9b, 0xfe)}${TEN_SPACES}${makeSGR()} Blue Background\n` +
					`${makeSGR(SGR.SetBackground, 2, 0x00, 0x00, 0x83)}${TEN_SPACES}${makeSGR()} Indigo Background\n` +
					`${makeSGR(SGR.SetBackground, 2, 0x30, 0x00, 0x9b)}${TEN_SPACES}${makeSGR()} Violet Background\n`
				);
				break;
			}

			case 'env clear': {
				// Clear each environment in turn
				for (const env of this._environments.values()) {
					env.clearAllVars();
				}
				this.simulateSuccessfulCodeExecution(id, code, 'Environment cleared.');
				break;
			}

			case 'help': {
				this.simulateSuccessfulCodeExecution(id, code, HelpLines);
				break;
			}

			case 'offline': {
				this.simulateOffline();
				break;
			}

			case 'progress': {
				this.simulateProgressBar(id, code);
				break;
			}

			case 'shutdown': {
				this.shutdown();
				break;
			}

			case 'version': {
				this.simulateSuccessfulCodeExecution(id, code, `Zed v${this.metadata.languageVersion} (${this.metadata.runtimeId})`);
				break;
			}

			default: {
				this.simulateUnsuccessfulCodeExecution(id, code, 'Unknown Command', `Error. '${code}' not recognized.\n`, []);
				break;
			}
		}
	}

	/**
	 * Tests a code fragment to see if it's complete.
	 * @param code The code to test for completeness.
	 * @returns A Thenable that resolves with the status of the code fragment.
	 */
	isCodeFragmentComplete(code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
		const parentId = randomUUID();
		this.simulateBusyState(parentId);
		this.simulateIdleState(parentId);
		return Promise.resolve(positron.RuntimeCodeFragmentStatus.Complete);
	}

	/**
	 * Create a new instance of a client.
	 *
	 * @param id The ID of the client.
	 * @param type The runtime client type.
	 */
	async createClient(id: string, type: positron.RuntimeClientType, _params: any) {
		if (type === positron.RuntimeClientType.Environment) {
			// Allocate a new ID and ZedEnvironment object for this environment backend
			const env = new ZedEnvironment(id, this.metadata.languageVersion);

			// Connect it and save the instance to coordinate future communication
			this.connectEnvironmentEmitter(env);
			this._environments.set(env.id, env);
		} else {
			// All other types are unknown to Zed
			throw new Error(`Unknown client type ${type}`);
		}
	}

	/**
	 * Removes an instance of a client.
	 */
	removeClient(id: string): void {
		// Right now, the only client instances are environments.
		if (this._environments.has(id)) {
			this._environments.delete(id);
		} else {
			throw new Error(`Can't remove client; unknown client id ${id}`);
		}
	}

	/**
	 * Send a message to the client instance.
	 * @param id The ID of the message.
	 * @param message The message.
	 */
	sendClientMessage(id: string, message: object): void {
		// Right now, the only client instances are environments.
		const client = this._environments.get(id);
		if (client) {
			client.handleMessage(message);
		} else {
			throw new Error(`Can't send message; unknown client id ${id}`);
		}
	}

	/**
	 * Replies to a prompt issued by the runtime.
	 * @param id The ID of the prompt.
	 * @param reply The reply of the prompt.
	 */
	replyToPrompt(id: string, reply: string): void {
		throw new Error('Method not implemented.');
	}

	/**
	 * Starts the runtime; returns a Thenable that resolves with information about the runtime.
	 * @returns A Thenable that resolves with information about the runtime
	 */
	start(): Promise<positron.LanguageRuntimeInfo> {
		// Zed 0.98.0 always fails to start.
		if (this.metadata.runtimeId === '00000000-0000-0000-0000-000000000098') {
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Uninitialized);
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Initializing);
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Starting);
			this.simulateErrorMessage(randomUUID(), 'StartupFailed', 'Startup failed');
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Exiting);
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Exited);
			return Promise.reject('Failure');
		}

		return new Promise<positron.LanguageRuntimeInfo>((resolve, reject) => {

			// Fire state changes.
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Uninitialized);
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Initializing);
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Starting);

			// Zed takes 1 second to start. This allows UI to be seen.
			setTimeout(() => {
				// Zed is ready now.
				this._onDidChangeRuntimeState.fire(positron.RuntimeState.Ready);

				// A lot of the time, a real runtime goes busy and then idle after it starts.
				setTimeout(() => {
					const parentId = randomUUID();
					this.simulateBusyState(parentId);
					this.simulateIdleState(parentId);
				}, 100);

				// Resolve.
				resolve({
					banner: `${makeSGR(SGR.ForegroundBlue)}Zed ${this.metadata.languageVersion}${makeSGR(SGR.Reset)}\nThis is the ${makeSGR(SGR.ForegroundGreen)}Zed${makeSGR(SGR.Reset)} test language.\n\nEnter 'help' for help.\n`,
					implementation_version: this.metadata.runtimeVersion,
					language_version: this.metadata.languageVersion,
				} as positron.LanguageRuntimeInfo);
			}, 1000);
		});
	}

	/**
	 * Interrupts the runtime.
	 */
	interrupt(): void {
		throw new Error('Method not implemented.');
	}

	/**
	 * Restarts the runtime.
	 */
	restart(): void {
		throw new Error('Method not implemented.');
	}

	/**
	 * Shuts down the runtime.
	 */
	shutdown(): void {
		// Simulate the busy/idle that happens first.
		const parentId = randomUUID();
		this.simulateBusyState(parentId);
		this.simulateIdleState(parentId);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Exiting);
		this.simulateOutputMessage(parentId, 'Zed Kernel exiting.');
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Exited);
	}

	//#endregion LanguageRuntime Implementation

	//#region Private Methods

	/**
	 * Simulates going offline for two seconds.
	 */
	private simulateOffline() {
		// Change state to offline.
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Offline);

		// Change state back to online after two seconds.
		setTimeout(() => {
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Ready);
		}, 2000);
	}

	/**
	 * Simulates a progress bar.
	 * @param parentId The parent identifier.
	 * @param code The code.
	 */
	private simulateProgressBar(parentId: string, code: string) {
		// Start the progress bar simulation.
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);
		this.simulateStreamMessage(parentId, positron.LanguageRuntimeStreamName.Stdout, 'Long running task:');
		this.simulateStreamMessage(parentId, positron.LanguageRuntimeStreamName.Stderr, 'Initializing task...');

		// After a tingle of delay, output the progress bar.
		setTimeout(() => {
			// Simulate the progress bar in 100 50ms intervals.
			let progress = 0;
			const interval = setInterval(() => {

				// Simulate progress.
				progress++;
				const bars = '#'.repeat(progress);
				const dashes = '-'.repeat(100 - progress);
				this.simulateStreamMessage(parentId, positron.LanguageRuntimeStreamName.Stderr, `${makeCUP(1, 1)}${makeEL('entire-line')}[${bars}${dashes}] ${progress}%`);

				if (progress === 50) {
					this.simulateStreamMessage(parentId, positron.LanguageRuntimeStreamName.Stdout, 'HALF WAY!!');
				}

				// When the progress bar reaches 100%, clear the interval.
				if (progress === 100) {
					clearInterval(interval);

					// End the progress bar.
					this.simulateStreamMessage(parentId, positron.LanguageRuntimeStreamName.Stdout, 'Long running task is completed.');
					this.simulateIdleState(parentId);
				}
			}, 25);

		}, 1000);
	}

	/**
	 * Simulates successful code execution.
	 * @param parentId The parent ID.
	 * @param code The code.
	 * @param output The optional output from the code.
	 */
	private simulateSuccessfulCodeExecution(parentId: string, code: string, output: string | undefined = undefined) {
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);
		this._history.push([code, output || '']);
		if (output) {
			this.simulateOutputMessage(parentId, output);
		}
		this.simulateIdleState(parentId);
	}

	/**
	 * Simulates unsuccessful code execution.
	 * @param parentId The parent ID.
	 * @param code The code.
	 * @param name The error name.
	 * @param message The error message.
	 * @param traceback The error traceback.
	 */
	private simulateUnsuccessfulCodeExecution(parentId: string, code: string, name: string, message: string, traceback: string[]) {
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);
		this.simulateErrorMessage(parentId, name, message, traceback);
		this.simulateIdleState(parentId);
	}

	/**
	 * Simulates transitioning to the busy state.
	 * @param parentId The parent identifier.
	 */
	private simulateBusyState(parentId: string) {
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.State,
			state: positron.RuntimeOnlineState.Busy
		} as positron.LanguageRuntimeState);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Busy);
	}

	/**
	 * Simulates transitioning to the idle state.
	 * @param parentId The parent identifier.
	 */
	private simulateIdleState(parentId: string) {
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.State,
			state: positron.RuntimeOnlineState.Idle
		} as positron.LanguageRuntimeState);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Idle);
	}

	/**
	 * Simulates sending an input message.
	 * @param parentId The parent identifier.
	 * @param code The code.
	 */
	private simulateInputMessage(parentId: string, code: string) {
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Input,
			state: positron.RuntimeOnlineState.Busy,
			code: code,
			execution_count: 1
		} as positron.LanguageRuntimeInput);
	}

	/**
	 * Simulates sending an output message.
	 * @param parentId The parent identifier.
	 * @param output The output.
	 */
	private simulateOutputMessage(parentId: string, output: string) {
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Output,
			data: {
				'text/plain': output
			} as Record<string, string>,
		} as positron.LanguageRuntimeOutput);
	}

	/**
	 * Simulates sending a stream message.
	 * @param parentId The parent identifier.
	 * @param text The output.
	 */
	private simulateStreamMessage(parentId: string, name: positron.LanguageRuntimeStreamName, text: string) {
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Stream,
			name,
			text
		} as positron.LanguageRuntimeStream);
	}

	/**
	 * Simulates sending an error message.
	 * @param parentId The parent identifier.
	 * @param name The name.
	 * @param message The message.
	 * @param traceback The traceback.
	 */
	private simulateErrorMessage(parentId: string, name: string, message: string, traceback: string[] = []) {
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Error,
			name,
			message,
			traceback
		} as positron.LanguageRuntimeError);
	}

	/**
	 * Proxies messages from an environment instance to Positron, by amending the appropriate
	 * metadata.
	 *
	 * @param env The environment to connect
	 */
	private connectEnvironmentEmitter(env: ZedEnvironment) {

		// Listen for data emitted from the environment instance
		env.onDidEmitData(data => {

			// When received, wrap it up in a runtime message and emit it
			this._onDidReceiveRuntimeMessage.fire({
				id: randomUUID(),
				parent_id: '',
				when: new Date().toISOString(),
				type: positron.LanguageRuntimeMessageType.CommData,
				comm_id: env.id,
				data: data
			} as positron.LanguageRuntimeCommMessage);
		});
	}

	//#endregion Private Methods
}
