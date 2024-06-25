/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { assertNoRpcFromEntry, disposeAll, poll } from '../../utils';
import { Disposable } from 'vscode';
import assert = require('assert');

class TestLanguageRuntimeSession implements positron.LanguageRuntimeSession {
	private readonly _onDidReceiveRuntimeMessage = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();
	private readonly _onDidChangeRuntimeState = new vscode.EventEmitter<positron.RuntimeState>();
	private readonly _onDidEndSession = new vscode.EventEmitter<positron.LanguageRuntimeExit>();

	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage> = this._onDidReceiveRuntimeMessage.event;
	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState> = this._onDidChangeRuntimeState.event;
	onDidEndSession: vscode.Event<positron.LanguageRuntimeExit> = this._onDidEndSession.event;

	readonly dynState = {
		inputPrompt: `T>`,
		continuationPrompt: 'T+',
	};

	constructor(
		readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly metadata: positron.RuntimeSessionMetadata
	) { }

	execute(_code: string, _id: string, _mode: positron.RuntimeCodeExecutionMode, _errorBehavior: positron.RuntimeErrorBehavior): void {
		throw new Error('Not implemented.');
	}

	async isCodeFragmentComplete(_code: string): Promise<positron.RuntimeCodeFragmentStatus> {
		throw new Error('Not implemented.');
	}

	async createClient(_id: string, _type: positron.RuntimeClientType, _params: any, _metadata?: any): Promise<void> {
		throw new Error('Not implemented.');
	}

	async listClients(_type?: positron.RuntimeClientType | undefined): Promise<Record<string, string>> {
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

	async start(): Promise<positron.LanguageRuntimeInfo> {
		throw new Error('Not implemented.');
	}

	async interrupt(): Promise<void> {
		throw new Error('Not implemented.');
	}

	async restart(): Promise<void> {
		throw new Error('Not implemented.');
	}

	async shutdown(_exitReason: positron.RuntimeExitReason): Promise<void> {
		throw new Error('Not implemented.');
	}

	async forceQuit(): Promise<void> {
		throw new Error('Not implemented.');
	}

	dispose() {
	}
}

function testLanguageRuntimeMetadata(): positron.LanguageRuntimeMetadata {
	const languageVersion = '0.0.1';
	const runtimeShortName = languageVersion;
	return {
		base64EncodedIconSvg: '',
		extraRuntimeData: {},
		languageId: 'test',
		languageName: 'Test',
		languageVersion,
		runtimeId: '00000000-0000-0000-0000-100000000000',
		runtimeName: `Test ${runtimeShortName}`,
		runtimePath: '/test',
		runtimeShortName,
		runtimeSource: 'Test',
		runtimeVersion: '0.0.1',
		sessionLocation: positron.LanguageRuntimeSessionLocation.Browser,
		startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit,
	};
}

class TestLanguageRuntimeManager implements positron.LanguageRuntimeManager {
	readonly onDidDiscoverRuntimeEmitter = new vscode.EventEmitter<positron.LanguageRuntimeMetadata>();

	onDidDiscoverRuntime = this.onDidDiscoverRuntimeEmitter.event;

	async* discoverRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		yield testLanguageRuntimeMetadata();
	}

	async createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata
	): Promise<positron.LanguageRuntimeSession> {
		return new TestLanguageRuntimeSession(runtimeMetadata, sessionMetadata);
	}
}

suite('positron API - runtime', () => {

	let disposables: Disposable[];
	setup(() => {
		disposables = [];
	});

	teardown(async function () {
		assertNoRpcFromEntry([positron, 'positron']);
		disposeAll(disposables);
	});

	test('register a runtime manager', async () => {
		const getRegisteredRuntimes = async () =>
			(await positron.runtime.getRegisteredRuntimes())
				.filter(runtime => runtime.languageId === 'test');

		assert.deepStrictEqual(
			await getRegisteredRuntimes(),
			[],
			'no test runtimes should be registered');

		// Register a manager.
		const manager = new TestLanguageRuntimeManager();
		const managerDisposable = positron.runtime.registerLanguageRuntimeManager(manager);

		// The manager's runtimes should eventually be registered.
		await poll(
			getRegisteredRuntimes,
			(runtimes) => runtimes.length > 0,
			'runtimes should be registered',
		);

		managerDisposable.dispose();

		// TODO: Unregistering a manager unregisters its runtimes, but doesn't remove them from
		//       the list returned by positron.runtime.getRegisteredRuntimes. Is that a bug?
		//       It also means that this test will currently fail if run out of order.
		// await poll(
		// 	getRegisteredRuntimes,
		// 	(runtimes) => runtimes.length === 0,
		// 	'test runtimes should be unregistered',
		// );
	});

});
