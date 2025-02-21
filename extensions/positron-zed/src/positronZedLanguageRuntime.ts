/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import * as positron from 'positron';
import { ZedPlot } from './positronZedPlot';
import { ZedPreview } from './positronZedPreview';
import { ZedVariables } from './positronZedVariables';
import { makeCUB, makeCUF, makeCUP, makeED, makeEL, makeSGR, SGR } from './ansi';
import { ZedUi as ZedUi } from './positronZedUi';
import { ZedConnection } from './positronZedConnection';

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
	'1k               - Inserts 1,000 lines of ANSI output',
	'ansi 16          - Displays standard ANSI colors as foreground and background colors',
	'ansi 256         - Displays indexed ANSI colors as foreground and background colors',
	'ansi blink       - Displays blinking output',
	'ansi cub         - Outputs text using CUB',
	'ansi cuf         - Outputs text using CUF',
	'ansi cup         - Outputs text using CUP',
	'ansi ed 0        - Clears to the end of the screen using ED',
	'ansi ed 1        - Clears to the beginning of the screen using ED',
	'ansi ed 2        - Clears an entire screen using ED',
	'ansi el 0        - Clears to the end of the line using EL',
	'ansi el 1        - Clears to the beginning of the line using EL',
	'ansi el 2        - Clears an entire line using EL',
	'ansi hidden      - Displays hidden text',
	'ansi rgb         - Displays RGB ANSI colors as foreground and background colors',
	'busy X Y         - Simulates an interuptible busy state for X seconds that takes Y seconds to interrupt (default X = 5, Y = 1)',
	'cd X             - Changes the current working directory to X, or to a random directory if X is not specified',
	'clock            - Show a plot containing a clock, using the notebook renderer API',
	'connection X     - Create a database connection, optionally named X',
	'connection close - Close a random database connection',
	'code X Y         - Simulates a successful X line input with Y lines of output (where X >= 1 and Y >= 0)',
	'crash            - Simulates a crash',
	'env clear        - Clears all variables from the environment',
	'env def X        - Defines X variables (randomly typed)',
	'env def X Y      - Defines X variables of type Y, where Y is one of: string, number, vector, list, or blob',
	'env max X        - Set the maximum number of displayed variables to X',
	'env rm X         - Removes X variables',
	'env update X     - Updates X variables',
	'error X Y Z      - Simulates an unsuccessful X line input with Y lines of error message and Z lines of traceback (where X >= 1 and Y >= 1 and Z >= 0)',
	'exec X Y         - Executes a code snippet Y in the language X interactively',
	'exec silent X Y  - Executes a code snippet Y in the language X silently',
	'fancy            - Simulates fancy HTML output',
	'flicker          - Simulates a flickering console prompt',
	'help             - Shows this help',
	'html             - Simulates HTML output',
	'modal            - Simulates a simple modal dialog',
	'offline          - Simulates going offline for two seconds',
	'plot X           - Renders a dynamic (auto-sizing) plot of the letter X',
	'preview          - Opens or gets the status of a preview pane',
	'preview open     - Opens a new preview pane',
	'preview close    - Closes the preview pane, if it is open',
	'preview status   - Gets the status of the preview pane',
	'preview show     - Shows the preview pane, if it is hidden',
	'preview msg      - Sends a message to the preview pane',
	'preview http...  - Show the URL starting with http... in the preview pane',
	'progress         - Renders a progress bar',
	'pwd              - Prints the current working directory',
	'restart          - Simulates orderly restart',
	'shutdown X       - Simulates orderly shutdown, or sets the shutdown delay to X',
	'static plot      - Renders a static plot (image)',
	'view X           - Open a data viewer named X (currently disabled)',
	'version          - Shows the Zed version'
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
export class PositronZedRuntimeSession implements positron.LanguageRuntimeSession {
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
	 * The onDidEndSession event emitter.
	 */
	private readonly _onDidEndSession = new vscode.EventEmitter<positron.LanguageRuntimeExit>();

	/**
	 * A history of executed commands
	 */
	private readonly _history: string[][] = [];

	/*
	 * A map of environment IDs to environment instances.
	 */
	private readonly _environments: Map<string, ZedVariables> = new Map();

	/*
	 * A map of connection IDs to connection instances.
	 */
	private readonly _connections: Map<string, ZedConnection> = new Map();

	/**
	 * The currently connected frontend, if any
	 */
	private _ui: ZedUi | undefined;

	/**
	 * A map of plot IDs to plot instances.
	 */
	private readonly _plots: Map<string, ZedPlot> = new Map();

	/**
	 * The active preview instance, if any.
	 */
	private _preview: ZedPreview | undefined;

	/**
	 * A stack of pending environment RPCs.
	 */
	private readonly _pendingRpcs: Array<string> = [];

	/**
	 * A timer for the busy state.
	 */
	private _busyTimer: NodeJS.Timer | undefined;

	/**
	 * The ID of the currently executing busy operation.
	 */
	private _busyOperationId: string | undefined;

	/**
	 * The number of seconds it should take to interrupt a busy operation. This
	 * is used to help simulate a state in which a runtime locks up during
	 * execution.
	 */
	private _busyInterruptSeconds: number;

	/**
	 * The number of seconds by which a shutdown should be delayed. This is used
	 * to help simulate a state in which a runtime locks up during shutdown.
	 */
	private _shutdownDelaySeconds: number;

	/**
	 * The current state of the runtime.
	 */
	private _state: positron.RuntimeState;

	/**
	 * The current working directory
	 */
	private _workingDirectory: string = '';

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param context The extension context.
	 * @param runtimeId The ID for the new runtime
	 * @param version The language version.
	 */
	constructor(
		readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly metadata: positron.RuntimeSessionMetadata,
		private readonly context: vscode.ExtensionContext,
	) {
		this._state = positron.RuntimeState.Uninitialized;

		this.dynState = {
			inputPrompt: `Z>`,
			continuationPrompt: 'Z+',
		};

		// Listen to our own state changes and update the state.
		this._onDidChangeRuntimeState.event((state) => {
			this._state = state;
		});

		// Default number of seconds it takes to interrupt a busy Zed runtime.
		this._busyInterruptSeconds = 1;

		// Default number of seconds it takes to shut down a Zed runtime.
		this._shutdownDelaySeconds = 1;
	}
	//#endregion Constructor

	//#region LanguageRuntime Implementation

	/**
	 * Dynamic state for the language runtime.
	 */
	dynState: positron.LanguageRuntimeDynState;

	/**
	 * An object that emits language runtime events.
	 */
	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage> = this._onDidReceiveRuntimeMessage.event;

	/**
	 * An object that emits the current state of the runtime.
	 */
	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState> = this._onDidChangeRuntimeState.event;

	/**
	 * An object that emits exit events.
	 */
	onDidEndSession: vscode.Event<positron.LanguageRuntimeExit> = this._onDidEndSession.event;

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
				message += `${makeSGR(SGR.ForegroundRed)}Error message line ${i}${makeSGR()}\n`;
			}

			// Build the traceback.
			const traceback: string[] = [];
			const tracebackLines = Math.max(Math.min(+match[3], 9), 0);
			if (tracebackLines) {
				// allow-any-unicode-next-line
				traceback.push('   ▆');
				for (let i = 0; i < tracebackLines; i++) {
					// allow-any-unicode-next-line
					traceback.push(`${i + 1}. ${' '.repeat(i * 2)}└─global function${i + 1}()`);
				}
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
		} else if (match = code.match(/^env max ([1-9]{1}[\d]*)/)) {
			const max = +match[1];
			if (this._environments.size > 0) {
				for (const environment of this._environments.values()) {
					environment.setMaxVarDisplay(max);
				}
			}
			return this.simulateSuccessfulCodeExecution(id, code,
				`Now displaying a maximum of ${max} variables.`);
		} else if (match = code.match(/^plot( [a-zA-Z])?/)) {
			// Create a plot. This takes a single-character argument that is
			// drawn in the middle of the plot. If no argument is given, the
			// letter "Z" is used.
			const letter = (match.length > 1 && match[1]) ? match[1].trim().toUpperCase() : 'Z';
			this.simulateDynamicPlot(id, letter, code);
			return;
		} else if (match = code.match(/^busy( [0-9]+)?( [0-9]+)?/)) {
			// Simulate a busy state.
			const duration = (match.length > 1 && match[1]) ? match[1].trim() : '5';
			const durationSeconds = parseInt(duration, 10);
			const interruptDuration = (match.length > 2 && match[2]) ? match[2].trim() : '1';
			this._busyInterruptSeconds = parseInt(interruptDuration, 10);
			this.simulateBusyOperation(id, durationSeconds, code);
			return;
		} else if (match = code.match(/^shutdown( [0-9]+)?/)) {
			if (match.length > 1 && match[1]) {
				// If the user specified a delay, set it.
				this.setShutdownDelay(id, parseInt(match[1].trim(), 10), code);
			} else {
				// If the user didn't specify a delay, just shut down.
				this.shutdown();
			}
			return;
		} else if (match = code.match(/^exec silent ([a-zA-Z]+) (.+)/)) {
			// Execute code silently in another language.
			const languageId = match[1];
			const codeToExecute = match[2];
			this.simulateCodeExecution(id, code, languageId, codeToExecute, positron.RuntimeCodeExecutionMode.Silent, positron.RuntimeErrorBehavior.Continue);
			return;
		} else if (match = code.match(/^exec ([a-zA-Z]+) (.+)/)) {
			// Execute code in another language.
			const languageId = match[1];
			const codeToExecute = match[2];
			this.simulateCodeExecution(id, code, languageId, codeToExecute, positron.RuntimeCodeExecutionMode.Interactive, positron.RuntimeErrorBehavior.Continue);
			return;
		} else if (match = code.match(/^preview( .+)?/)) {
			const command = (match.length > 1 && match[1]) ? match[1].trim() : 'default';
			this.simulatePreview(id, code, command);
			return;
		} else if (match = code.match(/^cd( .+)?/)) {
			const directory = (match.length > 1 && match[1]) ? match[1].trim() : '';
			this.simulateDirectoryChange(id, code, directory);
			return;
		} else if (match = code.match(/^connection( .+)?/)) {
			// Simulate a connection
			const title = (match.length > 1 && match[1]) ? match[1].trim() :
				`Connection ${this._connections.size + 1}`;
			if (title === 'close') {
				this.closeConnection(id, code);
			} else {
				this.simulateConnection(id, code, title);
			}
			return;
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

			case 'crash': {
				this.simulateCrash(id, code);
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

			case 'flicker': {
				// Start as with a typical code execution.
				this.simulateBusyState(id);
				// But introduce a second of delay between the busy state and the input message.
				setTimeout(() => {
					this.simulateInputMessage(id, code);
					this.simulateOutputMessage(id, 'The prompt and previous code fragment should have briefly disappeared.\n');
					this.simulateIdleState(id);
				}, 1000);
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

			case 'modal': {
				this.simulateModalDialog();
				break;
			}

			case 'progress': {
				this.simulateProgressBar(id, code);
				break;
			}

			case 'static plot': {
				this.simulateStaticPlot(id, code);
				break;
			}

			case 'fancy': {
				this.simulateFancyHtmlOutput(id, code);
				break;
			}

			case 'clock': {
				this.simulateNotebookOutputClock(id, code);
				break;
			}

			case 'html': {
				this.simulateHtmlOutput(id, code);
				break;
			}

			case 'markdown': {
				this.simulateMarkdownOutput(id, code);
				break;
			}

			case 'restart': {
				this.restart();
				break;
			}

			case 'version': {
				this.simulateSuccessfulCodeExecution(id, code, `Zed v${this.runtimeMetadata.languageVersion} (${this.runtimeMetadata.runtimeId})`);
				break;
			}

			case 'pwd': {
				this.simulateSuccessfulCodeExecution(id, code, this._workingDirectory);
				break;
			}

			default: {
				this.simulateUnsuccessfulCodeExecution(id, code, 'Unknown Command', `Error. '${code}' not recognized.\n`, []);
				break;
			}
		}
	}

	/**
	 * Stub placeholder for `callMethod`; not implemented in Zed.
	 */
	callMethod(method: string, ...args: any[]): Thenable<any> {
		return Promise.resolve({
			id: randomUUID(),
			result: {}
		});
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
		switch (type) {

			case positron.RuntimeClientType.Variables:
				// Create the variables client when requested
				this.createVariablesClient(id);
				break;

			case positron.RuntimeClientType.Ui:
				// Create the front-end client when requested
				this.createUiClient(id);

				// Immediately notify Positron of a "working directory"
				if (this._ui) {
					this._workingDirectory = this._ui.changeDirectory('');
				}
				break;

			case positron.RuntimeClientType.Help:
			case positron.RuntimeClientType.Lsp:
			case positron.RuntimeClientType.Dap:
				// These types aren't currently supported by Zed, so close the
				// comm immediately to signal this to the client.
				this._onDidReceiveRuntimeMessage.fire({
					id: randomUUID(),
					parent_id: '',
					when: new Date().toISOString(),
					type: positron.LanguageRuntimeMessageType.CommClosed,
					comm_id: id,
					data: {}
				} as positron.LanguageRuntimeCommClosed);
				break;

			case positron.RuntimeClientType.Plot:
			case positron.RuntimeClientType.DataExplorer:
				// These types can only be created by the back end; it's an
				// error if the front end tries to create one.
				throw new Error(`Client type ${type} cannot be created by the front end.`);
				break;

			default:
				// All other types are unknown to Zed
				throw new Error(`Unknown client type ${type}`);
		}
	}

	createVariablesClient(id: string) {
		// Allocate a new ID and ZedVariables object for this variables backend
		const env = new ZedVariables(id, this.runtimeMetadata.languageVersion, this);

		// Connect it and save the instance to coordinate future communication
		this.connectClientEmitter(env);
		this._environments.set(env.id, env);
	}

	/**
	 * Creates a new Zed UI client.
	 *
	 * @param id The ID of the client.
	 */
	createUiClient(id: string) {
		// Allocate a new ID and ZedVariables object for this variables backend
		const ui = new ZedUi(id);

		// Connect it and save the instance to coordinate future communication
		this.connectClientEmitter(ui);
		this._ui = ui;
	}

	/**
	 * Lists all clients of a given type.
	 *
	 * @param type The type of client to list. If undefined, all clients are listed.
	 * @returns The list of clients.
	 */
	async listClients(type?: positron.RuntimeClientType) {
		const clients: Record<string, string> = {};
		if (!type || type === positron.RuntimeClientType.Variables) {
			for (const env of this._environments.values()) {
				clients[env.id] = positron.RuntimeClientType.Variables;
			}
		}
		if (!type || type === positron.RuntimeClientType.Plot) {
			for (const plot of this._plots.values()) {
				clients[plot.id] = positron.RuntimeClientType.Plot;
			}
		}
		if (!type || type === positron.RuntimeClientType.Connection) {
			for (const connection of this._connections.values()) {
				clients[connection.id] = positron.RuntimeClientType.Connection;
			}
		}
		if (!type || type === positron.RuntimeClientType.Ui) {
			if (this._ui) {
				clients[this._ui.id] = positron.RuntimeClientType.Ui;
			}
		}
		return clients;
	}

	/**
	 * Removes an instance of a client.
	 *
	 * Currently, Zed understands environment and plot clients.
	 */
	removeClient(id: string): void {
		if (this._environments.has(id)) {
			// Is it ... an environment?
			this._environments.delete(id);
		} else if (this._plots.has(id)) {
			// Is it ... a plot?
			this._plots.delete(id);
		} else if (this._connections.has(id)) {
			this._connections.delete(id);
		} else {
			throw new Error(`Can't remove client; unknown client id ${id}`);
		}
	}

	/**
	 * Send a message to the client instance.
	 *
	 * @param id The ID of the message.
	 * @param message The message.
	 */
	sendClientMessage(client_id: string, message_id: string, message: object): void {

		// See if this ID is a known environment
		const env = this._environments.get(client_id);
		if (env) {
			this._pendingRpcs.push(message_id);
			env.handleMessage(message_id, message);
			return;
		}

		// See if this ID is a known plot
		const plot = this._plots.get(client_id);
		if (plot) {
			this._pendingRpcs.push(message_id);
			plot.handleMessage(message);
			return;
		}

		// See if this ID is a known connection
		const connection = this._connections.get(client_id);
		if (connection) {
			this._pendingRpcs.push(message_id);
			connection.handleMessage(message);
			return;
		}

		// It wasn't any of these! Give up.
		throw new Error(`Can't send message; unknown client id ${client_id}`);
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
	 * Set the working directory for the kernel.
	 *
	 * @param workingDirectory The working directory to set
	 */
	public setWorkingDirectory(workingDirectory: string): Promise<void> {
		this._workingDirectory = this._ui?.changeDirectory(workingDirectory) || '';
		return Promise.resolve();
	}

	/**
	 * Starts the runtime; returns a Thenable that resolves with information about the runtime.
	 * @returns A Thenable that resolves with information about the runtime
	 */
	start(): Promise<positron.LanguageRuntimeInfo> {
		// Zed 0.98.0 always fails to start. Simulate this by going directly
		// from Starting to Exited and rejecting the promise with a multi-line
		// error message.
		if (this.runtimeMetadata.runtimeId === '00000000-0000-0000-0000-000000000098') {
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Uninitialized);
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Initializing);
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Starting);
			this._onDidChangeRuntimeState.fire(positron.RuntimeState.Exited);
			return Promise.reject({
				message: 'Zed Startup failed',
				details: `Zed 0.98.0 always fails to start.\nFailure occured at ${new Date().toLocaleString()}.`
			});
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
					banner: `${makeSGR(SGR.ForegroundBlue)}Zed ${this.runtimeMetadata.languageVersion}${makeSGR(SGR.Reset)}\nThis is the ${makeSGR(SGR.ForegroundGreen)}Zed${makeSGR(SGR.Reset)} test language.\n\nEnter 'help' for help.\n`,
					implementation_version: this.runtimeMetadata.runtimeVersion,
					language_version: this.runtimeMetadata.languageVersion,
				} as positron.LanguageRuntimeInfo);
			}, 1000);
		});
	}

	/**
	 * Interrupts the runtime.
	 */
	async interrupt(): Promise<void> {
		if (this._busyTimer && this._state === positron.RuntimeState.Busy) {
			if (this._busyOperationId) {
				// Return to idle state.
				this.simulateOutputMessage(this._busyOperationId, 'Interrupting...');

				setTimeout(() => {
					// Consider: what is the parent of the idle state message? Is it the operation
					// we canceled, or is it the interrupt operation?
					this.simulateOutputMessage(this._busyOperationId!, 'Interrupted.');
					this.simulateIdleState(this._busyOperationId!);

					// Notify Positron that the interrupt is complete.
					if (this._ui) {
						this._ui.markBusy(false);
					}
					this._busyOperationId = undefined;
				}, this._busyInterruptSeconds * 1000);
			}

			clearTimeout(this._busyTimer);
			this._busyTimer = undefined;
		} else {
			throw new Error(`Can't interrupt; not busy or already interrupting`);
		}
	}

	/**
	 * Restarts the runtime.
	 */
	async restart(workingDirectory?: string): Promise<void> {
		// Let the user know what we're doing and go through the shutdown sequence.
		const parentId = randomUUID();
		this.simulateOutputMessage(parentId, 'Restarting.');
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Exited);
		this._onDidEndSession.fire({
			runtime_name: this.runtimeMetadata.runtimeName,
			exit_code: 0,
			reason: positron.RuntimeExitReason.Restart,
			message: ''
		});

		// Wait for a second before starting again.
		await new Promise(resolve => setTimeout(resolve, 500));

		// Apply new working directory
		if (workingDirectory) {
			this._workingDirectory = workingDirectory;
		}

		// Go through the startup sequence again.
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Initializing);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Starting);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Ready);
	}

	/**
	 * Shuts down the runtime.
	 */
	async shutdown(exitReason = positron.RuntimeExitReason.Shutdown): Promise<void> {
		const parentId = randomUUID();

		// Enter busy state to do shutdown processing.
		this.simulateBusyState(parentId);

		// Wait a bit to simulate shutdown processing.
		await new Promise(resolve => setTimeout(resolve, 1000 * this._shutdownDelaySeconds));

		// Did someone change the state on us during the delay? If so, we're not shutting down.
		if (this._state !== positron.RuntimeState.Busy) {
			return;
		}

		// Simulate closing all the open comms.
		const enviromentIds = Array.from(this._environments.keys());
		const plotIds = Array.from(this._plots.keys());
		const connectionIds = Array.from(this._connections.keys());
		const allIds = enviromentIds.concat(plotIds).concat(connectionIds);
		allIds.forEach(id => {
			this._onDidReceiveRuntimeMessage.fire({
				id: randomUUID(),
				parent_id: parentId,
				when: new Date().toISOString(),
				type: positron.LanguageRuntimeMessageType.CommClosed,
				comm_id: id,
				data: {}
			} as positron.LanguageRuntimeCommClosed);
		});

		// Enter idle state after shutdown processing.
		this.simulateIdleState(parentId);

		// Simulate state changes on exit.
		this.simulateOutputMessage(parentId, 'Zed Kernel exiting.');
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Exited);
		this._onDidEndSession.fire({
			runtime_name: this.runtimeMetadata.runtimeName,
			exit_code: 0,
			reason: exitReason,
			message: ''
		});
	}

	forceQuit(): Promise<void> {
		clearTimeout(this._busyTimer);
		// Simulate a force quit by immediately "exiting"
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Exited);
		this._onDidEndSession.fire({
			runtime_name: this.runtimeMetadata.runtimeName,
			exit_code: 0,
			reason: positron.RuntimeExitReason.ForcedQuit,
			message: ''
		});
		return Promise.resolve();
	}

	dispose(): void { }

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
	 * Opens the Preview pane.
	 *
	 * @param parentId The ID of the message that requested the preview pane open.
	 * @param code The code that was executed.
	 * @param command The preview subcommand.
	 */
	private simulatePreview(parentId: string, code: string, command: string) {
		// Enter busy state and output the code.
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);

		// Translate the 'default' command to 'open' or 'status' depending on the preview's state
		if (command === 'default') {
			if (this._preview) {
				command = 'status';
			} else {
				command = 'open';
			}
		}

		if (command.startsWith('http')) {
			// Close any existing preview
			if (this._preview) {
				this._preview.close();
			}

			// Parse the URL
			let uri: vscode.Uri | undefined;
			try {
				uri = vscode.Uri.parse(command);
			} catch (error) {
				this.simulateErrorMessage(parentId,
					`Very Bad URL`, `Error parsing URL '${command}': ${error}`);
				this.simulateIdleState(parentId);
				return;
			}

			// Ask Positron to preview the URL
			try {
				positron.window.previewUrl(uri);
			} catch (error) {
				this.simulateErrorMessage(parentId,
					`Preview Pane Flub`, `Error opening preview pane for '${command}: ${error}`);
			}

			// Return to idle state.
			this.simulateIdleState(parentId);
			return;
		}

		switch (command) {
			// Status ------------------------------------------------------------
			case 'status':
				if (this._preview) {
					const visible = this._preview.visible();
					this.simulateOutputMessage(parentId,
						`Preview pane is open; visible = ${visible}.`);
				} else {
					this.simulateOutputMessage(parentId,
						`The preview pane is not currently open.`);
				}
				break;

			// Open --------------------------------------------------------------
			case 'open':
				if (this._preview) {
					this.simulateOutputMessage(parentId, `The preview pane is already open. ` +
						`Use the 'show' command to make it visible, or 'status' to see its ` +
						`current state.`);
					break;
				}
				// Open the preview pane.
				try {
					const options: positron.PreviewOptions = {
						enableForms: true,
						enableScripts: true,
					};

					// Call Positron to create the preview panel.
					const preview = positron.window.createPreviewPanel(
						'positron.zedPreview', // View type
						'Zed Preview',         // View title (not currently shown)
						true,                  // OK to take focus
						options);

					// Create our wrapper around the preview pane.
					this._preview = new ZedPreview(this.context, preview);

					this._preview.onDidDispose(() => {
						// Clean out the preview object when the preview pane is closed.
						this._preview = undefined;
					});
					this.simulateOutputMessage(parentId, 'Preview pane opened.');
				} catch (error) {
					this.simulateOutputMessage(parentId, `Error opening preview pane: ${error}`);
				}
				break;

			// Show --------------------------------------------------------------
			case 'show':
				if (this._preview) {
					this.simulateOutputMessage(parentId,
						`Showing preview pane.`);
					this._preview.show();
				} else {
					this.simulateOutputMessage(parentId,
						`Cowardly refusing to show preview pane; it's not open. ` +
						`Use the 'preview open' command to open it.`);
				}
				break;

			// Close -------------------------------------------------------------
			case 'close':
				if (this._preview) {
					this.simulateOutputMessage(parentId,
						`Closing preview pane.`);
					this._preview.close();
				} else {
					this.simulateOutputMessage(parentId,
						`Cowardly refusing to close preview pane; it's not open. ` +
						`Use the 'preview open' command to open it.`);
				}
				break;

			// Message -----------------------------------------------------------
			case 'msg':
				if (this._preview) {
					this._preview.sendMessage();
				} else {
					this.simulateOutputMessage(parentId,
						`Cowardly refusing to send a message to the preview pane; it's not open. ` +
						`Use the 'preview open' command to open it.`);
				}
				break;

			default:
				this.simulateOutputMessage(parentId, `Unknown preview command '${command}'.`);
				break;
		}

		// Return to idle state.
		this.simulateIdleState(parentId);
	}

	/**
	 * Simulates a directory change by sending the relevant event to the UI comm.
	 *
	 * @param parentId The ID of the message that requested the directory change.
	 * @param code The code that was executed.
	 * @param directory The directory to change to.
	 */
	private simulateDirectoryChange(parentId: string, code: string, directory: string) {
		// Enter busy state and output the code.
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);

		if (this._ui) {
			this._workingDirectory = this._ui.changeDirectory(directory);
			this.simulateOutputMessage(parentId, `Changed directory to '${this._ui.directory}'.`);
		} else {
			this.simulateErrorMessage(parentId, 'No Frontend', 'No frontend is connected.', []);
		}

		// Return to idle state.
		this.simulateIdleState(parentId);
	}

	private async simulateModalDialog() {
		positron.window.showSimpleModalDialogPrompt('Howdy there!', 'You are using the Zed runtime right now.');
	}

	private simulateFancyHtmlOutput(parentId: string, code: string) {
		// Enter busy state and output the code.
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);

		const fancyHtmlPath = path.join(this.context.extensionPath, 'resources', 'inline.html');
		const fancyHtml = fs.readFileSync(fancyHtmlPath);

		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Output,
			data: {
				'text/plain': '<ZedHTML Fancy Object>',
				'text/html': fancyHtml.toString(),
			} as Record<string, string>
		} as positron.LanguageRuntimeOutput);

		// Return to idle state.
		this.simulateIdleState(parentId);
	}

	private simulateNotebookOutputClock(parentId: string, code: string) {
		// Enter busy state and output the code.
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);

		// Get the data for the clock.
		const now = new Date();
		const clockTime = {
			hour: now.getHours(),
			minute: now.getMinutes(),
			second: now.getSeconds(),
		};

		// Send the data as a notebook output of the type
		// 'application/vnd.zed.clock'. We supply a renderer for this type that
		// draws the digits in a plot-like way.
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Output,
			data: {
				'text/plain': '<ZedClock>',
				'application/vnd.zed.clock': JSON.stringify(clockTime),
			} as Record<string, string>
		} as positron.LanguageRuntimeOutput);

		// Return to idle state.
		this.simulateIdleState(parentId);
	}

	private simulateHtmlOutput(parentId: string, code: string) {
		// Enter busy state and output the code.
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);

		const html = `
		<h2>HTML Output</h2>
		<small style="text-transform: uppercase">
			This is a sample HTML output from the Zed kernel, &amp; it's good.
			&copy; 2023 Zed, Inc.
		</small>
		<table class="dataframe">
		<thead>
			<tr>
				<th>Fibonacci Number</th>
				<th>Name</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<td>1</td>
				<td>One</td>
			</tr>
			<tr>
				<td>1</td>
				<td>One</td>
			</tr>
			<tr>
				<td>2</td>
				<td>Two</td>
			</tr>
			<tr>
				<td>3</td>
				<td>Three</td>
			</tr>
			<tr>
				<td>5</td>
				<td>Five</td>
			</tr>
		</tbody>
		</table>
		<button>Click Me (Nothing will Happen)</button>`;
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Output,
			data: {
				'text/plain': '<ZedHTML Object>',
				'text/html': html
			} as Record<string, string>
		} as positron.LanguageRuntimeOutput);

		// Return to idle state.
		this.simulateIdleState(parentId);
	}

	private simulateMarkdownOutput(parentId: string, code: string) {
		// Enter busy state and output the code.
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);

		const mdPath = path.join(this.context.extensionPath, 'resources', 'markdown.md');
		const md = fs.readFileSync(mdPath).toString();

		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Output,
			data: {
				'text/plain': '<ZedMarkdown>',
				'text/markdown': md
			} as Record<string, string>
		} as positron.LanguageRuntimeOutput);

		this.simulateIdleState(parentId);
	}

	private simulateStaticPlot(parentId: string, code: string) {
		// Enter busy state and output the code.
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);

		// Read the plot data from the file in the extension's resources folder.
		const plotPngPath = path.join(this.context.extensionPath, 'resources', 'zed-logo.png');
		const plotPng = fs.readFileSync(plotPngPath);

		// Encode the data to base64.
		const plotPngBase64 = Buffer.from(plotPng).toString('base64');

		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Output,
			data: {
				'text/plain': '<ZedPLOT 325x325>',
				'image/png': plotPngBase64
			} as Record<string, string>
		} as positron.LanguageRuntimeOutput);

		// Return to idle state.
		this.simulateIdleState(parentId);
	}

	/**
	 * Simulates execution of code in another language.
	 *
	 * @param parentId The parent identifier.
	 * @param code The Zed code the user entered.
	 * @param languageId The language identifier
	 * @param codeToExecute The code to execute.
	 * @param mode The execution mode to conform to.
	 * @param errorBehavior The error behavior to conform to.
	 */
	private async simulateCodeExecution(parentId: string,
		code: string,
		languageId: string,
		codeToExecute: string,
		mode: positron.RuntimeCodeExecutionMode,
		errorBehavior: positron.RuntimeErrorBehavior) {
		// Enter busy state and output the code.
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);

		// Let the user know what we're about to do
		this.simulateOutputMessage(parentId, `Executing ${languageId} snippet: ${codeToExecute}`);

		// Don't focus the console if code should being executed silently
		const focus = mode !== positron.RuntimeCodeExecutionMode.Silent;

		// Perform the execution
		const success = await positron.runtime.executeCode(languageId, codeToExecute, focus, true, mode, errorBehavior);
		if (!success) {
			this.simulateOutputMessage(parentId, `Failed; is there an active console for ${languageId}?`);
		}

		// Return to idle state.
		this.simulateIdleState(parentId);
	}

	/**
	 * Sets the shutdown delay, in seconds, for the next shutdown operation.
	 *
	 * @param parentId The parent identifier.
	 * @param delay The delay in seconds.
	 * @param code The code.
	 */
	private setShutdownDelay(parentId: string, delay: number, code: string) {
		// Enter busy state and output the code.
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);
		this._shutdownDelaySeconds = delay;
		this.simulateOutputMessage(parentId, `Shutdown delay set to ${delay} seconds.`);
		this.simulateIdleState(parentId);
	}

	/**
	 * Simulates a dynamic plot. Zed plots a single letter.
	 *
	 * @param parentId The parent identifier.
	 * @param letter The plot letter.
	 * @param code The code.
	 */
	private simulateDynamicPlot(parentId: string, letter: string, code: string) {
		// Enter busy state and output the code.
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);

		// Create the plot client comm.
		const plot = new ZedPlot(this.context, letter);
		this.connectClientEmitter(plot);
		this._plots.set(plot.id, plot);

		// Send the comm open message to the client.
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.CommOpen,
			comm_id: plot.id,
			target_name: 'positron.plot',
			data: {}
		} as positron.LanguageRuntimeCommOpen);

		// Emit text output so something shows up in the console.
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Output,
			data: {
				'text/plain': `<ZedDynamic PLOT '${letter}'>`
			} as Record<string, string>
		} as positron.LanguageRuntimeOutput);

		// Return to idle state.
		this.simulateIdleState(parentId);
	}

	/**
	 * Simulates a database connection.
	 *
	 * @param parentId The parent identifier.
	 * @param code The code.
	 * @param name The name of the connection.
	 */
	private simulateConnection(parentId: string, code: string, name: string) {
		// Enter busy state and output the code.
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);

		// Create the connection client comm.
		const connection = new ZedConnection(this, name);
		this.connectClientEmitter(connection);
		this._connections.set(connection.id, connection);

		// Send the comm open message to the client.
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.CommOpen,
			comm_id: connection.id,
			target_name: 'positron.connection',
			data: {
				name: name
			}
		} as positron.LanguageRuntimeCommOpen);

		// Emit text output so something shows up in the console.
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Output,
			data: {
				'text/plain': `<ZedConnection '${name}'>`
			} as Record<string, string>
		} as positron.LanguageRuntimeOutput);

		// Return to idle state.
		this.simulateIdleState(parentId);
	}

	private closeConnection(parentId: string, code: string) {
		// Enter busy state and output the code.
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);

		if (this._connections.size === 0) {
			this.simulateErrorMessage(parentId,
				'No Connections Open',
				'There are no connections open to close. ' +
				'Open a connection with the "connection" command', []);
		}
		else {

			// Create the connection client comm.
			const target = this._connections.values().next().value;
			this._connections.delete(target!.id);

			// Send the comm open message to the client.
			this._onDidReceiveRuntimeMessage.fire({
				id: randomUUID(),
				parent_id: parentId,
				when: new Date().toISOString(),
				type: positron.LanguageRuntimeMessageType.CommClosed,
				comm_id: target!.id,
				target_name: 'positron.connection',
				data: { name: target!.name }
			} as positron.LanguageRuntimeCommClosed);

			// Emit text output so something shows up in the console.
			this._onDidReceiveRuntimeMessage.fire({
				id: randomUUID(),
				parent_id: parentId,
				when: new Date().toISOString(),
				type: positron.LanguageRuntimeMessageType.Output,
				data: {
					'text/plain': `Connection '${target!.name}' closed`
				} as Record<string, string>
			} as positron.LanguageRuntimeOutput);
		}

		// Return to idle state.
		this.simulateIdleState(parentId);

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

		// Mark the runtime as busy while we show the progress bar.
		if (this._ui) {
			this._ui.markBusy(true);
		}

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
					if (this._ui) {
						this._ui.markBusy(false);
					}
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

		// If the preview is open, add it to the preview's recent commands.
		if (this._preview) {
			this._preview.addRecentCommand(code);
		}
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
	 * Proxies messages from an environment or plot instance to Positron, by
	 * amending the appropriate metadata.
	 *
	 * @param client The environment or plot to connect
	 */
	private connectClientEmitter(client: ZedVariables | ZedPlot | ZedUi | ZedConnection) {

		// Listen for data emitted from the environment instance
		client.onDidEmitData(data => {

			// If there's a pending RPC, then presume that this message is a
			// reply to it; otherwise, just use an empty parent ID.
			const parent_id = this._pendingRpcs.length > 0 ?
				this._pendingRpcs.pop() : '';

			// When received, wrap it up in a runtime message and emit it
			this._onDidReceiveRuntimeMessage.fire({
				id: randomUUID(),
				parent_id,
				when: new Date().toISOString(),
				type: positron.LanguageRuntimeMessageType.CommData,
				comm_id: client.id,
				data: data
			} as positron.LanguageRuntimeCommMessage);
		});
	}

	/**
	 * Simulates transitioning to the busy state.
	 * @param parentId The parent identifier.
	 */
	private simulateBusyOperation(parentId: string, durationSeconds: number, code: string) {
		// Enter the busy state and echo the code
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);

		// Acknowledge the command
		this.simulateOutputMessage(parentId, `Entering busy state for ${durationSeconds} seconds.`);

		// Notify the frontend that a computation is in progress
		if (this._ui) {
			this._ui.markBusy(true);
		}

		// Exit the busy state after the specified duration. We save the timer to a
		// private field so that we can cancel it if the user interrupts the kernel.
		this._busyOperationId = parentId;
		this._busyTimer = setTimeout(() => {
			// All done. Exit the busy state.
			this.simulateIdleState(parentId);
			this.simulateOutputMessage(parentId, `Exiting busy state.`);
			this._busyTimer = undefined;

			// Notify frontend that the computation is complete
			if (this._ui) {
				this._ui.markBusy(false);
			}
		}, durationSeconds * 1000);
	}

	/**
	 * Simulates a crash.
	 *
	 * @param parentId The parent ID.
	 * @param code The code.
	 * @param output The optional output from the code.
	 */
	private simulateCrash(parentId: string, code: string, output: string | undefined = undefined) {
		this.simulateBusyState(parentId);
		this.simulateInputMessage(parentId, code);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Exited);
		this._onDidEndSession.fire({
			runtime_name: this.runtimeMetadata.runtimeName,
			exit_code: 137,
			reason: positron.RuntimeExitReason.Error,
			message: `I'm terribly sorry, but a segmentation fault has occurred.`
		});
	}
	//#endregion Private Methods
}
