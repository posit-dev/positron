/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import * as positron from 'positron';

/**
 * PositronZedLanguageRuntime.
 */
export class PositronZedLanguageRuntime implements positron.LanguageRuntime {
	//#region Private Properties

	/**
	 * The onDidReceiveRuntimeMessage event emitter.
	 */
	private readonly _onDidReceiveRuntimeMessage: vscode.EventEmitter<positron.LanguageRuntimeMessage> = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();

	/**
	 * The onDidChangeRuntimeState event emitter.
	 */
	private readonly _onDidChangeRuntimeState: vscode.EventEmitter<positron.RuntimeState> = new vscode.EventEmitter<positron.RuntimeState>();

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The language ID.
	 * @param version The language version.
	 */
	constructor(id: string, version: string) {
		this.metadata = {
			id,
			language: 'Zed',
			name: 'Zed',
			version,
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

	//#region  Public Properties

	/**
	 * Execute code in the runtime.
	 * @param code The code to exeucte.
	 * @param id The ID of the operation.
	 * @param mode The execution mode to conform to.
	 * @param errorBehavior The error behavior to conform to.
	 */
	execute(code: string, id: string, mode: positron.RuntimeCodeExecutionMode, errorBehavior: positron.RuntimeErrorBehavior): void {
		const busy: positron.LanguageRuntimeState = {
			id: randomUUID(),
			parent_id: id,
			type: positron.LanguageRuntimeMessageType.State,
			state: positron.RuntimeOnlineState.Busy
		};
		this._onDidReceiveRuntimeMessage.fire(busy);

		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Busy);

		const result = code === 'version' ?
			`==Z ZED ${this.metadata.version} ${this.metadata.id} Z==` :
			`++Z "${code}" Z++`;
		const output: positron.LanguageRuntimeOutput = {
			id: randomUUID(),
			parent_id: id,
			type: positron.LanguageRuntimeMessageType.Output,
			data: {
				'text/plain': result
			} as any,
		};

		this._onDidReceiveRuntimeMessage.fire(output);

		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Idle);

		const idle: positron.LanguageRuntimeState = {
			id: randomUUID(),
			parent_id: id,
			type: positron.LanguageRuntimeMessageType.State,
			state: positron.RuntimeOnlineState.Idle
		};
		this._onDidReceiveRuntimeMessage.fire(idle);
	}

	/**
	 * Tests a code fragment to see if it's complete.
	 * @param code The code to test for completeness.
	 * @returns A Thenable that resolves with the status of the code fragment.
	 */
	isCodeFragmentComplete(code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
		// All Zed code fragments are complete. There is no incomplete code in
		// Zed. ALL IS COMPLETE IN ZED
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
	start(): Thenable<positron.LanguageRuntimeInfo> {

		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Ready);
		return Promise.resolve({
			banner: `Zed ${this.metadata.version}`,
			implementation_version: '1.0.0',
			language_version: this.metadata.version
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
}
