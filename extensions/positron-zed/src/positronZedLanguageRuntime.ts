/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import * as positron from 'positron';
import { MakeSGR, SGR } from './ansi';
import * as ansi from 'ansi-escape-sequences';

/**
 * Constants.
 */
export const ESC = '\x1b';
export const CSI = ESC + '[';

/**
 * The help lines.
 */
const HelpLines = [
	'Zed help:',
	'',
	'ansi 16     - Displays the standard ANSI colors as foreground and background colors',
	'ansi 256    - Displays the indexed ANSI colors as foreground and background colors',
	'code X Y    - Simulates a successful X line input with Y lines of output (where X >= 1 and Y >= 0)',
	'error X Y Z - Simulates an unsuccessful X line input with Y lines of error message and Z lines of traceback (where X >= 1 and Y >= 1 and Z >= 0)',
	'help        - Shows this help',
	'offline     - Simulates going offline for two seconds',
	'progress    - Renders a progress bar',
	'shutdown    - Simulates orderly shutdown',
	'version     - Shows the Zed version'
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
		}

		// Process the "code".
		switch (code) {
			case '':
				this.simulateSuccessfulCodeExecution(id, code);
				break;

			case 'ansi 16':
				console.log(`Red is ${ansi.style.red}`);
				this.simulateSuccessfulCodeExecution(id, code,
					`Standard ANSI colors:\n` +
					`${MakeSGR(SGR.ForegroundBlack)}This is foreground black\n` +
					`${MakeSGR(SGR.ForegroundRed)}This is foreground red\n` +
					`${MakeSGR(SGR.ForegroundGreen)}This is foreground green\n` +
					`${MakeSGR(SGR.ForegroundYellow)}This is foreground yellow\n` +
					`${MakeSGR(SGR.ForegroundBlue)}This is foreground blue\n` +
					`${MakeSGR(SGR.ForegroundMagenta)}This is foreground magenta\n` +
					`${MakeSGR(SGR.ForegroundCyan)}This is foreground cyan text\n` +
					`${MakeSGR(SGR.ForegroundWhite)}This is foreground white\n` +
					`${MakeSGR(SGR.ForegroundBrightBlack)}This is foreground bright black\n` +
					`${MakeSGR(SGR.ForegroundBrightRed)}This is foreground bright red\n` +
					`${MakeSGR(SGR.ForegroundBrightGreen)}This is foreground bright green\n` +
					`${MakeSGR(SGR.ForegroundBrightYellow)}This is foreground bright yellow\n` +
					`${MakeSGR(SGR.ForegroundBrightBlue)}This is foreground bright blue\n` +
					`${MakeSGR(SGR.ForegroundBrightMagenta)}This is foreground bright magenta\n` +
					`${MakeSGR(SGR.ForegroundBrightCyan)}This is foreground bright cyan\n` +
					`${MakeSGR(SGR.ForegroundBrightWhite)}This is foreground bright white\n` +
					`${MakeSGR(SGR.BackgroundBlack)}This is background black\n` +
					`${MakeSGR(SGR.BackgroundRed)}This is background red\n` +
					`${MakeSGR(SGR.BackgroundGreen)}This is background green\n` +
					`${MakeSGR(SGR.BackgroundYellow)}This is background yellow\n` +
					`${MakeSGR(SGR.BackgroundBlue)}This is background blue\n` +
					`${MakeSGR(SGR.BackgroundMagenta)}This is background magenta\n` +
					`${MakeSGR(SGR.BackgroundCyan)}This is background cyan\n` +
					`${MakeSGR(SGR.BackgroundWhite)}This is background white\n` +
					`${MakeSGR(SGR.BackgroundBrightBlack)}This is background bright black\n` +
					`${MakeSGR(SGR.BackgroundBrightRed)}This is background bright red\n` +
					`${MakeSGR(SGR.BackgroundBrightGreen)}This is background bright green\n` +
					`${MakeSGR(SGR.BackgroundBrightYellow)}This is background bright yellow\n` +
					`${MakeSGR(SGR.BackgroundBrightBlue)}This is background bright blue\n` +
					`${MakeSGR(SGR.BackgroundBrightMagenta)}This is background bright magenta\n` +
					`${MakeSGR(SGR.BackgroundBrightCyan)}This is background bright cyan\n` +
					`${MakeSGR(SGR.BackgroundBrightWhite)}This is background bright white${MakeSGR()}`
				);
				break;

			case 'ansi 256': {
				let output = '';
				for (let i = 0; i < 16; i++) {
					for (let j = 0; j < 16; j++) {
						const colorIndex = i * 16 + j;
						output += ` ${MakeSGR(SGR.SetForeground, 5, colorIndex)}${rightAlignedThreeDigitDecimal(colorIndex)}${MakeSGR()} `;
					}
					output += `${MakeSGR()}\n`;
				}

				output += '\n';

				for (let i = 0; i < 16; i++) {
					for (let j = 0; j < 16; j++) {
						const colorIndex = i * 16 + j;
						output += ` ${MakeSGR(SGR.SetBackground, 5, colorIndex)}${rightAlignedThreeDigitDecimal(colorIndex)}${MakeSGR()} `;
					}
					output += `${MakeSGR()}\n`;
				}
				this.simulateSuccessfulCodeExecution(id, code, output);
				break;
			}

			case 'help':
				this.simulateSuccessfulCodeExecution(id, code, HelpLines);
				break;

			case 'offline':
				this.simulateOffline();
				break;

			case 'progress':
				this.simulateProgressBar(id, code);
				break;

			case 'shutdown':
				this.shutdown();
				break;

			case 'version':
				this.simulateSuccessfulCodeExecution(id, code, `Zed v${this.metadata.languageVersion} (${this.metadata.runtimeId})`);
				break;

			default:
				this.simulateUnsuccessfulCodeExecution(id, code, 'Unknown Command', `Error. '${code}' not recognized.\n`, []);
				break;
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
	 * @param type The runtime client type.
	 */
	createClient(type: positron.RuntimeClientType): string {
		throw new Error('Method not implemented.');
	}

	/**
	 * Removes an instance of a client.
	 */
	removeClient(id: string): void {
		throw new Error('Method not implemented.');
	}

	/**
	 * Send a message to the client instance.
	 * @param id The ID of the message.
	 * @param message The message.
	 */
	sendClientMessage(id: string, message: any): void {
		throw new Error('Method not implemented.');
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

		// Fire state changes.
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Uninitialized);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Initializing);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Starting);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Ready);

		// A lot of the time, a real runtime goes busy and then idle after it starts.
		setTimeout(() => {
			const parentId = randomUUID();
			this.simulateBusyState(parentId);
			this.simulateIdleState(parentId);
		}, 100);

		// Done.
		return Promise.resolve({
			banner: `${MakeSGR(SGR.ForegroundBlue)}Zed ${this.metadata.languageVersion}${MakeSGR(SGR.Reset)}\nThis is the ${MakeSGR(SGR.ForegroundGreen)}Zed${MakeSGR(SGR.Reset)} test language.\n\nEnter 'help' for help.\n`,
			implementation_version: this.metadata.runtimeVersion,
			language_version: this.metadata.languageVersion,
		} as positron.LanguageRuntimeInfo);
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
		this.simulateOutputMessage(parentId, 'Starting long running task');

		// After a tingle of delay, output the progress bar.
		setTimeout(() => {
			// Simulate the progress bar in 100 50ms intervals.
			let progress = 0;
			const interval = setInterval(() => {
				// Simulate progress - (need to add ANSI escapes)
				this.simulateOutputMessage(parentId, `Progress ${++progress}%`);

				// When the progress bar reaches 100%, clear the interval.
				if (progress === 100) {
					clearInterval(interval);
				}
			}, 50);

			// End the progress bar.
			this.simulateOutputMessage(parentId, 'Long running task is complete');
			this.simulateIdleState(parentId);
		}, 500);
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

	//#endregion Private Methods
}
