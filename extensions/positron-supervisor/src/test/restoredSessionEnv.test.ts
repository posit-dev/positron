/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { KallichoreSession } from '../KallichoreSession';
import { KallichoreTransport } from '../KallichoreApiInstance';
import { ActiveSession, DefaultApi, InterruptMode, SessionMode, Status, VarActionType } from '../kcclient/api';
import { JupyterKernelSpec } from '../positron-supervisor';

/**
 * Regression tests for restoring the launch environment when restarting a
 * reconnected session.
 *
 * When the extension host restarts, the supervisor reconnects to still-running
 * kernels via `restore()` rather than `create()`, so the session no longer
 * holds the original kernel spec. A subsequent restart rebuilds the kernel
 * environment via `buildEnvVarActions()`. If that rebuild dropped the launch
 * environment, spec-provided entries such as the bundled ipykernel path on
 * PYTHONPATH would be lost and the restarted kernel would fail to import its
 * dependencies (e.g. `ModuleNotFoundError: No module named 'psutil'`).
 *
 * See https://github.com/posit-dev/positron/issues/10016.
 */
suite('Restored session environment', () => {

	function createRuntimeMetadata(): positron.LanguageRuntimeMetadata {
		return {
			runtimePath: '/usr/bin/python3',
			runtimeId: '00000000-0000-0000-0000-000000000000',
			runtimeName: 'Python 3.12',
			runtimeShortName: '3.12',
			runtimeVersion: '0.1',
			runtimeSource: 'Test',
			languageName: 'Python',
			languageId: 'python',
			languageVersion: '3.12.0',
			base64EncodedIconSvg: undefined,
			startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit,
			sessionLocation: positron.LanguageRuntimeSessionLocation.Workspace,
			extraRuntimeData: {},
		};
	}

	function createSessionMetadata(): positron.RuntimeSessionMetadata {
		return {
			sessionId: 'python-test-0001',
			sessionMode: positron.LanguageRuntimeSessionMode.Console,
			notebookUri: undefined,
		};
	}

	/** An `ActiveSession` as returned by the server when reconnecting. */
	function activeSession(initialEnv?: { [key: string]: string }): ActiveSession {
		return {
			session_id: 'python-test-0001',
			argv: ['python3', '-m', 'positron_language_server'],
			username: 'test',
			display_name: 'Python 3.12',
			language: 'python',
			interrupt_mode: InterruptMode.Message,
			initial_env: initialEnv,
			connected: true,
			started: new Date().toISOString(),
			session_mode: SessionMode.Console,
			working_directory: '/home/test',
			input_prompt: '>>>',
			continuation_prompt: '...',
			execution_queue: { length: 0, pending: [] },
			status: Status.Idle,
			kernel_info: { language_info: { version: '3.12.0' } },
			idle_seconds: 0,
			busy_seconds: 0,
		};
	}

	function newSession(isNew: boolean): KallichoreSession {
		return new KallichoreSession(
			createSessionMetadata(),
			createRuntimeMetadata(),
			{ sessionName: 'Python 3.12', inputPrompt: '>>>', continuationPrompt: '...' },
			// `newSession` is the only API method exercised here (by `create`).
			{ newSession: async () => { /* no-op */ } } as unknown as DefaultApi,
			KallichoreTransport.TCP,
			async () => { /* server is assumed running */ },
			isNew,
		);
	}

	test('restart of a restored session replays the launch environment', async () => {
		// A restored (reconnected) session has no original kernel spec, so the
		// launch environment recorded by the server -- including the bundled
		// ipykernel path on PYTHONPATH -- must be replayed on restart.
		const session = newSession(/* isNew */ false);
		session.restore(activeSession({
			PYTHONPATH: '/bundled/ipykernel:/existing/path',
			POSITRON_TEST_LAUNCH_VAR: 'launch-value',
		}));
		try {
			const actions = await session.buildEnvVarActions(true);

			// Ignore Positron's own variables and any host-contributed variables;
			// assert only that the recorded launch environment is replayed.
			const replayed = actions.filter(
				a => a.name === 'PYTHONPATH' || a.name === 'POSITRON_TEST_LAUNCH_VAR');
			assert.deepStrictEqual(replayed, [
				{ action: VarActionType.Replace, name: 'PYTHONPATH', value: '/bundled/ipykernel:/existing/path' },
				{ action: VarActionType.Replace, name: 'POSITRON_TEST_LAUNCH_VAR', value: 'launch-value' },
			]);
		} finally {
			session.dispose();
		}
	});

	test('the original kernel spec takes precedence over the recorded launch environment', async () => {
		// A freshly created session holds its kernel spec. Even if server data
		// with a different environment is also present, the spec must win --
		// the recorded launch environment is only a fallback for reconnected
		// sessions, and must not override the current spec.
		const session = newSession(/* isNew */ true);
		const kernelSpec: JupyterKernelSpec = {
			argv: ['python3', '-m', 'positron_language_server'],
			display_name: 'Python 3.12',
			language: 'python',
			kernel_protocol_version: '5.3',
			env: { PYTHONPATH: '/spec/path' },
		};
		await session.create(kernelSpec);
		session.restore(activeSession({ PYTHONPATH: '/reconnect/path' }));
		try {
			const actions = await session.buildEnvVarActions(true);
			const pythonPath = actions.filter(a => a.name === 'PYTHONPATH');
			assert.deepStrictEqual(pythonPath, [
				{ action: VarActionType.Replace, name: 'PYTHONPATH', value: '/spec/path' },
			]);
		} finally {
			session.dispose();
		}
	});
});
