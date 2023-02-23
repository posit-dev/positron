/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import * as positron from 'positron';

/**
 * Constants.
 */
const ESC = '\x1b';		// ESC
const CSI = ESC + '[';	// CSI

/**
 * PositronZedLanguageRuntime.
 */
export class PositronZedLanguageRuntime implements positron.LanguageRuntime {
	//#region Private Properties

	/**
	 * Gets the help lines.
	 */
	private readonly _helpLines = [
		'Zed help:',
		'',
		'code X Y    - Simulates a successful X line input with Y lines of output (where X >= 1 and Y >= 0)',
		'error X Y Z - Simulates an unsuccessful X line input with Y lines of error message and Z lines of traceback (where X >= 1 and Y >= 1 and Z >= 0)',
		'help        - Shows this help',
		'progress    - Renders a progress bar',
		'version     - Shows the Zed version'
	].join('\n');

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

			case 'help':
				this.simulateSuccessfulCodeExecution(id, code, this._helpLines);
				break;

			case 'progress':
				this.simulateProgressBar(id, code);
				break;

			case 'version':
				this.simulateSuccessfulCodeExecution(id, code, `Zed v${this.metadata.languageVersion} (${this.metadata.runtimeId})\n`);
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
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Ready);
		return Promise.resolve({
			banner: `Zed ${this.metadata.languageVersion}\nThis is the Zed test language.\n\nEnter 'help' for help.\n`,
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
		throw new Error('Method not implemented.');
	}

	//#endregion LanguageRuntime Implementation

	//#region Private Methods

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
	private simulateErrorMessage(parentId: string, name: string, message: string, traceback: string[]) {
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
