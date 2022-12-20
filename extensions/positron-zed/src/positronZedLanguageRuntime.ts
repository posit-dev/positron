/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import * as positron from 'positron';

/**
 * PositronZedLanguageRuntime.
 */
export class PositronZedLanguageRuntime implements positron.LanguageRuntime {
	/**
	 * The onDidReceiveRuntimeMessage event emitter.
	 */
	private readonly _onDidReceiveRuntimeMessage: vscode.EventEmitter<positron.LanguageRuntimeMessage> = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();

	/**
	 * The onDidChangeRuntimeState event emitter.
	 */
	private readonly _onDidChangeRuntimeState: vscode.EventEmitter<positron.RuntimeState> = new vscode.EventEmitter<positron.RuntimeState>();

	/**
	 * Gets the metadata for the language runtime.
	 */
	readonly metadata: positron.LanguageRuntimeMetadata = {
		id: '7282a3c7-c6b7-4652-b59d-a10506f2d21a',
		language: 'Zed',
		name: 'Zed',
		version: '1.0.0'
	};

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

		const busy: positron.LanguageRuntimeState = {
			id: randomUUID(),
			parent_id: id,
			type: positron.LanguageRuntimeMessageType.State,
			state: positron.RuntimeOnlineState.Busy
		};
		this._onDidReceiveRuntimeMessage.fire(busy);

		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Busy);

		const output: positron.LanguageRuntimeOutput = {
			id: randomUUID(),
			parent_id: id,
			type: positron.LanguageRuntimeMessageType.Output,
			data: {
				'text/plain': `++Z "${code}" Z++`
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
			banner: 'Zed',
			implementation_version: '1.0.0',
			language_version: '1.0.0'
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
}
