/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { ILanguageRuntimeSession, IRuntimeClientInstance, IRuntimeSessionMetadata, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { ILanguageRuntimeClientCreatedEvent, ILanguageRuntimeExit, ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeMessageClearOutput, ILanguageRuntimeMessageError, ILanguageRuntimeMessageInput, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessagePrompt, ILanguageRuntimeMessageResult, ILanguageRuntimeMessageState, ILanguageRuntimeMessageStream, ILanguageRuntimeMetadata, ILanguageRuntimeStartupFailure, LanguageRuntimeMessageType, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeExitReason, RuntimeOnlineState, RuntimeOutputKind, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeClientEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeUiClient';
import { TestRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/test/common/testRuntimeClientInstance';

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

	readonly dynState = {
		inputPrompt: `T>`,
		continuationPrompt: 'T+',
		currentWorkingDirectory: '',
		busy: false,
	};

	private readonly _languageVersion = '0.0.1';
	readonly runtimeMetadata: ILanguageRuntimeMetadata = {
		base64EncodedIconSvg: '',
		extensionId: new ExtensionIdentifier('test-extension'),
		extraRuntimeData: {},
		languageId: 'test',
		languageName: 'Test',
		languageVersion: this._languageVersion,
		runtimeId: '00000000-0000-0000-0000-100000000000',
		runtimeName: `Test ${this._languageVersion}`,
		runtimePath: '/test',
		runtimeShortName: this._languageVersion,
		runtimeSource: 'Test',
		runtimeVersion: '0.0.1',
		sessionLocation: LanguageRuntimeSessionLocation.Browser,
		startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
	};

	readonly metadata: IRuntimeSessionMetadata;

	readonly sessionId: string;

	clientInstances = new Array<IRuntimeClientInstance<any, any>>();

	constructor(
		sessionMode: LanguageRuntimeSessionMode = LanguageRuntimeSessionMode.Console,
		notebookUri?: URI,
	) {
		super();

		this.sessionId = 'session-id';

		this.metadata = {
			createdTimestamp: Date.now(),
			sessionId: this.sessionId,
			sessionMode,
			sessionName: 'session-name',
			startReason: 'test',
			notebookUri,
		};

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
		throw new Error('Not implemented.');
	}

	async interrupt(): Promise<void> {
		throw new Error('Not implemented.');
	}

	async restart(): Promise<void> {
		throw new Error('Not implemented.');
	}

	async shutdown(_exitReason: RuntimeExitReason): Promise<void> {
		throw new Error('Not implemented.');
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

	override dispose() {
		super.dispose();
	}

	// Test helpers

	setRuntimeState(state: RuntimeState) {
		this._currentState = state;
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

	receiveClearOutputMessage(message: Partial<ILanguageRuntimeMessageClearOutput>) {
		const clearOutput = {
			...this._defaultMessage(message, LanguageRuntimeMessageType.Output),
			wait: message.wait ?? false,
		};
		this._onDidReceiveRuntimeMessageClearOutput.fire(clearOutput);
		return clearOutput;
	}

	receiveOutputMessage(message: Partial<ILanguageRuntimeMessageOutput>) {
		const output = {
			...this._defaultMessage(message, LanguageRuntimeMessageType.Output),
			kind: message.kind ?? RuntimeOutputKind.Unknown,
			data: message.data ?? {},
		};
		this._onDidReceiveRuntimeMessageOutput.fire(output);
		return output;
	}

	receiveResultMessage(message: Partial<ILanguageRuntimeMessageResult>) {
		const result = {
			...this._defaultMessage(message, LanguageRuntimeMessageType.Result),
			kind: message.kind ?? RuntimeOutputKind.Unknown,
			data: message.data ?? {},
		};
		this._onDidReceiveRuntimeMessageResult.fire(result);
		return result;
	}

	receiveStreamMessage(message: Partial<ILanguageRuntimeMessageStream>) {
		const stream = {
			...this._defaultMessage(message, LanguageRuntimeMessageType.Stream),
			name: message.name ?? 'stdout',
			text: message.text ?? '',
		};
		this._onDidReceiveRuntimeMessageStream.fire(stream);
		return stream;
	}

	receiveInputMessage(message: Partial<ILanguageRuntimeMessageInput>) {
		const input = {
			...this._defaultMessage(message, LanguageRuntimeMessageType.Input),
			code: message.code ?? '',
			execution_count: message.execution_count ?? 0,
		};
		this._onDidReceiveRuntimeMessageInput.fire(input);
		return input;
	}

	receiveErrorMessage(message: Partial<ILanguageRuntimeMessageError>) {
		const error = {
			...this._defaultMessage(message, LanguageRuntimeMessageType.Error),
			name: message.name ?? 'Error',
			message: message.message ?? '',
			traceback: [],
		};
		this._onDidReceiveRuntimeMessageError.fire(error);
		return error;
	}

	receivePromptMessage(message: Partial<ILanguageRuntimeMessagePrompt>) {
		const prompt = {
			...this._defaultMessage(message, LanguageRuntimeMessageType.Prompt),
			prompt: message.prompt ?? '',
			password: message.password ?? false,
		};
		this._onDidReceiveRuntimeMessagePrompt.fire(prompt);
		return prompt;
	}

	receiveStateMessage(message: Partial<ILanguageRuntimeMessageState>) {
		const state = {
			...this._defaultMessage(message, LanguageRuntimeMessageType.State),
			state: message.state ?? RuntimeOnlineState.Idle,
		};
		this._onDidReceiveRuntimeMessageState.fire(state);
		return state;
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
