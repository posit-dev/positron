/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { ILanguageRuntimeSession, IRuntimeClientInstance, IRuntimeSessionMetadata, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { ILanguageRuntimeClientCreatedEvent, ILanguageRuntimeExit, ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeMessageClearOutput, ILanguageRuntimeMessageError, ILanguageRuntimeMessageInput, ILanguageRuntimeMessageIPyWidget, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessagePrompt, ILanguageRuntimeMessageResult, ILanguageRuntimeMessageState, ILanguageRuntimeMessageStream, ILanguageRuntimeMetadata, ILanguageRuntimeStartupFailure, LanguageRuntimeMessageType, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeExitReason, RuntimeOnlineState, RuntimeOutputKind, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeClientEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeUiClient';
import { TestRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/test/common/testRuntimeClientInstance';
import { CancellationError } from 'vs/base/common/errors';

export class TestLanguageRuntimeSession extends Disposable implements ILanguageRuntimeSession {
	private readonly _onDidChangeRuntimeState = this._register(new Emitter<RuntimeState>());
	private readonly _onDidCompleteStartup = this._register(new Emitter<ILanguageRuntimeInfo>());
	private readonly _onDidEncounterStartupFailure = this._register(new Emitter<ILanguageRuntimeStartupFailure>());
	private readonly _onDidReceiveRuntimeMessage = this._register(new Emitter<ILanguageRuntimeMessage>());
	private readonly _onDidEndSession = this._register(new Emitter<ILanguageRuntimeExit>());
	private readonly _onDidCreateClientInstance = this._register(new Emitter<ILanguageRuntimeClientCreatedEvent>());

	private readonly _onDidReceiveRuntimeMessageClearOutput = this._register(new Emitter<ILanguageRuntimeMessageClearOutput>());
	private readonly _onDidReceiveRuntimeMessageOutput = this._register(new Emitter<ILanguageRuntimeMessageOutput>());
	private readonly _onDidReceiveRuntimeMessageResult = this._register(new Emitter<ILanguageRuntimeMessageResult>());
	private readonly _onDidReceiveRuntimeMessageStream = this._register(new Emitter<ILanguageRuntimeMessageStream>());
	private readonly _onDidReceiveRuntimeMessageInput = this._register(new Emitter<ILanguageRuntimeMessageInput>());
	private readonly _onDidReceiveRuntimeMessageError = this._register(new Emitter<ILanguageRuntimeMessageError>());
	private readonly _onDidReceiveRuntimeMessagePrompt = this._register(new Emitter<ILanguageRuntimeMessagePrompt>());
	private readonly _onDidReceiveRuntimeMessageState = this._register(new Emitter<ILanguageRuntimeMessageState>());
	private readonly _onDidReceiveRuntimeClientEvent = this._register(new Emitter<IRuntimeClientEvent>());
	private readonly _onDidReceiveRuntimeMessagePromptConfig = this._register(new Emitter<void>());
	private readonly _onDidReceiveRuntimeMessageIPyWidgetEmitter = new Emitter<ILanguageRuntimeMessageIPyWidget>();

	private _currentState = RuntimeState.Uninitialized;

	private _clients = new Map<string, TestRuntimeClientInstance>();

	onDidChangeRuntimeState = this._onDidChangeRuntimeState.event;
	onDidCompleteStartup = this._onDidCompleteStartup.event;
	onDidEncounterStartupFailure = this._onDidEncounterStartupFailure.event;
	onDidReceiveRuntimeMessage = this._onDidReceiveRuntimeMessage.event;
	onDidEndSession = this._onDidEndSession.event;
	onDidCreateClientInstance = this._onDidCreateClientInstance.event;

	onDidReceiveRuntimeMessageClearOutput = this._onDidReceiveRuntimeMessageClearOutput.event;
	onDidReceiveRuntimeMessageOutput = this._onDidReceiveRuntimeMessageOutput.event;
	onDidReceiveRuntimeMessageResult = this._onDidReceiveRuntimeMessageResult.event;
	onDidReceiveRuntimeMessageStream = this._onDidReceiveRuntimeMessageStream.event;
	onDidReceiveRuntimeMessageInput = this._onDidReceiveRuntimeMessageInput.event;
	onDidReceiveRuntimeMessageError = this._onDidReceiveRuntimeMessageError.event;
	onDidReceiveRuntimeMessagePrompt = this._onDidReceiveRuntimeMessagePrompt.event;
	onDidReceiveRuntimeMessageState = this._onDidReceiveRuntimeMessageState.event;
	onDidReceiveRuntimeClientEvent = this._onDidReceiveRuntimeClientEvent.event;
	onDidReceiveRuntimeMessagePromptConfig = this._onDidReceiveRuntimeMessagePromptConfig.event;
	onDidReceiveRuntimeMessageIPyWidget = this._onDidReceiveRuntimeMessageIPyWidgetEmitter.event;

	readonly dynState = {
		inputPrompt: `T>`,
		continuationPrompt: 'T+',
		currentWorkingDirectory: '',
		busy: false,
	};

	readonly sessionId: string;

	clientInstances = new Array<IRuntimeClientInstance<any, any>>();

	constructor(
		readonly metadata: IRuntimeSessionMetadata,
		readonly runtimeMetadata: ILanguageRuntimeMetadata,
	) {
		super();

		this.sessionId = this.metadata.sessionId;

		// Track the runtime state.
		this._register(this.onDidChangeRuntimeState(state => this._currentState = state));
	}

	getRuntimeState(): RuntimeState {
		return this._currentState;
	}

	openResource(_resource: URI | string): Promise<boolean> {
		throw new Error('Not implemented.');
	}

	execute(
		_code: string,
		_id: string,
		_mode: RuntimeCodeExecutionMode,
		_errorBehavior: RuntimeErrorBehavior
	): void {
		throw new Error('Not implemented.');
	}

	async isCodeFragmentComplete(_code: string): Promise<RuntimeCodeFragmentStatus> {
		throw new Error('Not implemented.');
	}

	async createClient(
		type: RuntimeClientType, params: any, metadata?: any, id?: string
	): Promise<TestRuntimeClientInstance> {
		const client = this._register(new TestRuntimeClientInstance(id ?? generateUuid(), type));
		this._clients.set(client.getClientId(), client);
		this._onDidCreateClientInstance.fire(
			{
				client,
				message: {
					id: generateUuid(),
					comm_id: client.getClientId(),
					target_name: type,
					data: params,
					metadata: metadata,
					event_clock: 0,
					parent_id: '',
					type: LanguageRuntimeMessageType.CommOpen,
					when: new Date().toISOString(),
					buffers: [],
				}
			}
		);
		return client;
	}

	async listClients(type?: RuntimeClientType): Promise<Array<TestRuntimeClientInstance>> {
		return Array.from(this._clients.values())
			.filter(client => !type || client.getClientType() === type);
	}

	removeClient(_id: string): void {
		throw new Error('Not implemented.');
	}

	sendClientMessage(_client_id: string, _message_id: string, _message: any): void {
		throw new Error('Not implemented.');
	}

	replyToPrompt(_id: string, _reply: string): void {
		throw new Error('Not implemented.');
	}

	async start(): Promise<ILanguageRuntimeInfo> {
		this._onDidChangeRuntimeState.fire(RuntimeState.Starting);

		// Complete the startup on the next tick, trying to match real runtime behavior.
		setTimeout(() => {
			this._onDidChangeRuntimeState.fire(RuntimeState.Ready);
		}, 0);

		return {
			banner: 'Test runtime started',
			implementation_version: this.runtimeMetadata.runtimeVersion,
			language_version: this.runtimeMetadata.languageVersion,
		};
	}

	async interrupt(): Promise<void> {
		throw new Error('Not implemented.');
	}

	async restart(): Promise<void> {
		await this.shutdown(RuntimeExitReason.Restart);

		// Wait for the session to exit, then start it again.
		const disposable = this._register(this.onDidChangeRuntimeState(state => {
			if (state === RuntimeState.Exited) {
				disposable.dispose();
				this.start();
			}
		}));
	}

	async shutdown(exitReason: RuntimeExitReason): Promise<void> {
		if (this._currentState !== RuntimeState.Idle &&
			this._currentState !== RuntimeState.Busy &&
			this._currentState !== RuntimeState.Ready) {
			throw new Error('Cannot shut down kernel; it is not (yet) running.' +
				` (state = ${this._currentState})`);
		}

		if (exitReason === RuntimeExitReason.Restart) {
			this._onDidChangeRuntimeState.fire(RuntimeState.Restarting);
		} else {
			this._onDidChangeRuntimeState.fire(RuntimeState.Exiting);
		}

		// Complete the shutdown on the next tick, trying to match real runtime behavior.
		setTimeout(() => {
			this._onDidChangeRuntimeState.fire(RuntimeState.Exited);
			this._onDidEndSession.fire({
				runtime_name: this.runtimeMetadata.runtimeName,
				exit_code: 0,
				reason: exitReason,
				message: '',
			});
		}, 0);
	}

	async forceQuit(): Promise<void> {
		throw new Error('Not implemented.');
	}

	showOutput(): void {
		throw new Error('Not implemented.');
	}

	async showProfile(): Promise<void> {
		throw new Error('Not implemented.');
	}

	// Test helpers

	setRuntimeState(state: RuntimeState) {
		this._onDidChangeRuntimeState.fire(state);
	}

	private _defaultMessage(
		message: Partial<ILanguageRuntimeMessage>,
		type: LanguageRuntimeMessageType,
	): ILanguageRuntimeMessage {
		return {
			id: message.id ?? generateUuid(),
			type: type,
			parent_id: message.parent_id ?? '',
			event_clock: message.event_clock ?? 0,
			when: message.when ?? new Date().toISOString(),
			metadata: message.metadata ?? new Map(),
			buffers: [],
		};
	}

	private _clearOutputMessage(
		message: Partial<ILanguageRuntimeMessageClearOutput>,
	): ILanguageRuntimeMessageClearOutput {
		return {
			...this._defaultMessage(message, LanguageRuntimeMessageType.Output),
			wait: message.wait ?? false,
		};
	}

	private _outputMessage(message: Partial<ILanguageRuntimeMessageOutput>): ILanguageRuntimeMessageOutput {
		return {
			...this._defaultMessage(message, LanguageRuntimeMessageType.Output),
			kind: message.kind ?? RuntimeOutputKind.Unknown,
			data: message.data ?? {},
		};
	}

	private _resultMessage(message: Partial<ILanguageRuntimeMessageResult>): ILanguageRuntimeMessageResult {
		return {
			...this._defaultMessage(message, LanguageRuntimeMessageType.Result),
			kind: message.kind ?? RuntimeOutputKind.Unknown,
			data: message.data ?? {},
		};
	}

	private _streamMessage(message: Partial<ILanguageRuntimeMessageStream>): ILanguageRuntimeMessageStream {
		return {
			...this._defaultMessage(message, LanguageRuntimeMessageType.Stream),
			name: message.name ?? 'stdout',
			text: message.text ?? '',
		};
	}

	private _inputMessage(message: Partial<ILanguageRuntimeMessageInput>): ILanguageRuntimeMessageInput {
		return {
			...this._defaultMessage(message, LanguageRuntimeMessageType.Input),
			code: message.code ?? '',
			execution_count: message.execution_count ?? 0,
		};
	}

	private _errorMessage(message: Partial<ILanguageRuntimeMessageError>): ILanguageRuntimeMessageError {
		return {
			...this._defaultMessage(message, LanguageRuntimeMessageType.Error),
			name: message.name ?? 'Error',
			message: message.message ?? '',
			traceback: [],
		};
	}

	private _promptMessage(message: Partial<ILanguageRuntimeMessagePrompt>): ILanguageRuntimeMessagePrompt {
		return {
			...this._defaultMessage(message, LanguageRuntimeMessageType.Prompt),
			prompt: message.prompt ?? '',
			password: message.password ?? false,
		};
	}

	private _stateMessage(message: Partial<ILanguageRuntimeMessageState>): ILanguageRuntimeMessageState {
		return {
			...this._defaultMessage(message, LanguageRuntimeMessageType.State),
			state: message.state ?? RuntimeOnlineState.Idle,
		};
	}

	private _ipyWidgetMessage(
		message: Partial<ILanguageRuntimeMessageIPyWidget>,
		originalMessage: Partial<ILanguageRuntimeMessage> & { type: LanguageRuntimeMessageType },
	): ILanguageRuntimeMessageIPyWidget {
		return {
			...this._defaultMessage(message, LanguageRuntimeMessageType.IPyWidget),
			original_message: this._defaultMessage(originalMessage, originalMessage.type),
		};
	}

	receiveClearOutputMessage(message: Partial<ILanguageRuntimeMessageClearOutput>) {
		const clearOutput = this._clearOutputMessage(message);
		this._onDidReceiveRuntimeMessageClearOutput.fire(clearOutput);
		return clearOutput;
	}

	receiveOutputMessage(message: Partial<ILanguageRuntimeMessageOutput>) {
		const output = this._outputMessage(message);
		this._onDidReceiveRuntimeMessageOutput.fire(output);
		return output;
	}

	receiveResultMessage(message: Partial<ILanguageRuntimeMessageResult>) {
		const result = this._resultMessage(message);
		this._onDidReceiveRuntimeMessageResult.fire(result);
		return result;
	}

	receiveStreamMessage(message: Partial<ILanguageRuntimeMessageStream>) {
		const stream = this._streamMessage(message);
		this._onDidReceiveRuntimeMessageStream.fire(stream);
		return stream;
	}

	receiveInputMessage(message: Partial<ILanguageRuntimeMessageInput>) {
		const input = this._inputMessage(message);
		this._onDidReceiveRuntimeMessageInput.fire(input);
		return input;
	}

	receiveErrorMessage(message: Partial<ILanguageRuntimeMessageError>) {
		const error = this._errorMessage(message);
		this._onDidReceiveRuntimeMessageError.fire(error);
		return error;
	}

	receivePromptMessage(message: Partial<ILanguageRuntimeMessagePrompt>) {
		const prompt = this._promptMessage(message);
		this._onDidReceiveRuntimeMessagePrompt.fire(prompt);
		return prompt;
	}

	receiveStateMessage(message: Partial<ILanguageRuntimeMessageState>) {
		const state = this._stateMessage(message);
		this._onDidReceiveRuntimeMessageState.fire(state);
		return state;
	}

	receiveIPyWidgetMessage(
		message: Partial<ILanguageRuntimeMessageIPyWidget>,
		originalMessage: Partial<ILanguageRuntimeMessage> & { type: LanguageRuntimeMessageType },
	) {
		const ipyWidget = this._ipyWidgetMessage(message, originalMessage);
		this._onDidReceiveRuntimeMessageIPyWidgetEmitter.fire(ipyWidget);
		return ipyWidget;
	}

	endSession(exit?: Partial<ILanguageRuntimeExit>) {
		this._onDidEndSession.fire({
			exit_code: exit?.exit_code ?? 0,
			message: exit?.message ?? '',
			reason: exit?.reason ?? RuntimeExitReason.Unknown,
			runtime_name: this.runtimeMetadata.runtimeName,
		});
	}
}

export async function waitForRuntimeState(
	session: ILanguageRuntimeSession,
	state: RuntimeState,
	timeout = 10_000,
) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			disposable.dispose();
			reject(new CancellationError());
		}, timeout);

		const disposable = session.onDidChangeRuntimeState(newState => {
			if (newState === state) {
				clearTimeout(timer);
				disposable.dispose();
				resolve();
			}
		});
	});
}
