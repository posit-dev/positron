/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { KallichoreSession } from '../KallichoreSession';
import { KallichoreTransport } from '../KallichoreApiInstance';
import { DefaultApi } from '../kcclient/api';

function createRuntimeMetadata(): positron.LanguageRuntimeMetadata {
	return {
		runtimePath: '/usr/bin/R',
		runtimeId: '00000000-0000-0000-0000-000000000000',
		runtimeName: 'R 4.5.2',
		runtimeShortName: '4.5',
		runtimeVersion: '0.1',
		runtimeSource: 'Test',
		languageName: 'R',
		languageId: 'r',
		languageVersion: '4.5.2',
		base64EncodedIconSvg: undefined,
		startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit,
		sessionLocation: positron.LanguageRuntimeSessionLocation.Workspace,
		extraRuntimeData: {},
	};
}

function createSessionMetadata(): positron.RuntimeSessionMetadata {
	return {
		sessionId: 'r-test-0001',
		sessionMode: positron.LanguageRuntimeSessionMode.Console,
		notebookUri: undefined,
	};
}

/**
	 * The session has no Kallichore server or websocket. Tests drive it with
	 * `handleMessage()` and supply only the `api` endpoints they exercise.
 */
export function createSession(api: object = {}): KallichoreSession {
	return new KallichoreSession(
		createSessionMetadata(),
		createRuntimeMetadata(),
		{ sessionName: 'R 4.5.2', inputPrompt: '>', continuationPrompt: '+' },
		api as unknown as DefaultApi,
		KallichoreTransport.TCP,
		async () => { /* server is assumed running */ },
		/* new */ true,
	);
}


export function markConnected(session: KallichoreSession) {
	session.handleMessage({ kind: 'kernel', status: { status: 'offline', reason: 'test setup' } });
	session.handleMessage({ kind: 'kernel', status: { status: 'idle', reason: 'test setup' } });
}


export function markExited(session: KallichoreSession) {
	session.handleMessage({ kind: 'kernel', status: { status: 'exited', reason: 'child process exited' } });
	session.handleMessage({ kind: 'kernel', exited: 0 });
}
