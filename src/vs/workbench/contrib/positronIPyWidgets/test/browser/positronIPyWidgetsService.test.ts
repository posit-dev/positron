/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { ILogService, NullLogger } from 'vs/platform/log/common/log';
import { IPyWidgetsInstance } from 'vs/workbench/contrib/positronIPyWidgets/browser/positronIPyWidgetsService';
import { IIPyWidgetsWebviewMessaging } from 'vs/workbench/services/languageRuntime/common/languageRuntimeIPyWidgetClient';
import { ILanguageRuntimeClientCreatedEvent, ILanguageRuntimeExit, ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeMessageError, ILanguageRuntimeMessageInput, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessagePrompt, ILanguageRuntimeMessageResult, ILanguageRuntimeMessageState, ILanguageRuntimeMessageStream, ILanguageRuntimeMetadata, ILanguageRuntimeStartupFailure, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeExitReason, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeClientEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeUiClient';
import { ILanguageRuntimeSession, IRuntimeClientInstance, IRuntimeSessionMetadata, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

class TestLanguageRuntimeSession implements ILanguageRuntimeSession {
	private readonly _onDidChangeRuntimeState = new Emitter<RuntimeState>();
	private readonly _onDidCompleteStartup = new Emitter<ILanguageRuntimeInfo>();
	private readonly _onDidEncounterStartupFailure = new Emitter<ILanguageRuntimeStartupFailure>();
	private readonly _onDidReceiveRuntimeMessage = new Emitter<ILanguageRuntimeMessage>();
	private readonly _onDidEndSession = new Emitter<ILanguageRuntimeExit>();
	private readonly _onDidCreateClientInstance = new Emitter<ILanguageRuntimeClientCreatedEvent>();

	private readonly _onDidReceiveRuntimeMessageOutput = new Emitter<ILanguageRuntimeMessageOutput>();
	private readonly _onDidReceiveRuntimeMessageResult = new Emitter<ILanguageRuntimeMessageResult>();
	private readonly _onDidReceiveRuntimeMessageStream = new Emitter<ILanguageRuntimeMessageStream>();
	private readonly _onDidReceiveRuntimeMessageInput = new Emitter<ILanguageRuntimeMessageInput>();
	private readonly _onDidReceiveRuntimeMessageError = new Emitter<ILanguageRuntimeMessageError>();
	private readonly _onDidReceiveRuntimeMessagePrompt = new Emitter<ILanguageRuntimeMessagePrompt>();
	private readonly _onDidReceiveRuntimeMessageState = new Emitter<ILanguageRuntimeMessageState>();
	private readonly _onDidReceiveRuntimeClientEvent = new Emitter<IRuntimeClientEvent>();
	private readonly _onDidReceiveRuntimeMessagePromptConfig = new Emitter<void>();

	onDidChangeRuntimeState = this._onDidChangeRuntimeState.event;
	onDidCompleteStartup = this._onDidCompleteStartup.event;
	onDidEncounterStartupFailure = this._onDidEncounterStartupFailure.event;
	onDidReceiveRuntimeMessage = this._onDidReceiveRuntimeMessage.event;
	onDidEndSession = this._onDidEndSession.event;
	onDidCreateClientInstance = this._onDidCreateClientInstance.event;

	onDidReceiveRuntimeMessageOutput = this._onDidReceiveRuntimeMessageOutput.event;
	onDidReceiveRuntimeMessageResult = this._onDidReceiveRuntimeMessageResult.event;
	onDidReceiveRuntimeMessageStream = this._onDidReceiveRuntimeMessageStream.event;
	onDidReceiveRuntimeMessageInput = this._onDidReceiveRuntimeMessageInput.event;
	onDidReceiveRuntimeMessageError = this._onDidReceiveRuntimeMessageError.event;
	onDidReceiveRuntimeMessagePrompt = this._onDidReceiveRuntimeMessagePrompt.event;
	onDidReceiveRuntimeMessageState = this._onDidReceiveRuntimeMessageState.event;
	onDidReceiveRuntimeClientEvent = this._onDidReceiveRuntimeClientEvent.event;
	onDidReceiveRuntimeMessagePromptConfig = this._onDidReceiveRuntimeMessagePromptConfig.event;

	getRuntimeState(): RuntimeState {
		throw new Error('Not implemented.');
	}

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

	readonly metadata: IRuntimeSessionMetadata = {
		createdTimestamp: Date.now(),
		sessionId: 'session-id',
		sessionMode: LanguageRuntimeSessionMode.Console,
		sessionName: 'session-name',
		startReason: 'test',
		notebookUri: undefined,
	};

	readonly sessionId = this.metadata.sessionId;

	clientInstances = new Array<IRuntimeClientInstance<any, any>>();

	constructor() { }

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

	async createClient<T, U>(
		_type: RuntimeClientType, _params: any, _metadata?: any, id?: string
	): Promise<IRuntimeClientInstance<T, U>> {
		throw new Error('Not implemented.');
	}

	async listClients(
		_type?: RuntimeClientType | undefined
	): Promise<Array<IRuntimeClientInstance<any, any>>> {
		throw new Error('Not implemented.');
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

	dispose() {
	}
}

suite('IPyWidgetsInstance', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let ipywidgetsInstance: IPyWidgetsInstance;

	setup(async () => {
		const logService = new NullLogger() as unknown as ILogService;
		const session = disposables.add(new TestLanguageRuntimeSession());
		const messaging = <IIPyWidgetsWebviewMessaging>{};
		ipywidgetsInstance = disposables.add(new IPyWidgetsInstance(
			session,
			messaging,
			logService,
		));
	});

	test('TODO', async () => {

	});
});
