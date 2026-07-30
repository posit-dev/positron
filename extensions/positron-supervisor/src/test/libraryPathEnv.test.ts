/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as positron from 'positron';
import { KallichoreSession } from '../KallichoreSession';
import { KallichoreTransport } from '../KallichoreApiInstance';
import { DefaultApi, VarActionType } from '../kcclient/api';
import { JupyterKernelSpec } from '../positron-supervisor';

/**
 * Regression tests for how library search path variables (LD_LIBRARY_PATH,
 * DYLD_LIBRARY_PATH) supplied by a kernel spec are turned into environment
 * variable actions.
 *
 * The R kernel spec injects `$R_HOME/lib` on these variables to help ark find
 * R's shared libraries. Applying that as a Replace action clobbers any value
 * already present in the environment -- such as paths added by `module load` or
 * inherited from the launching shell -- so packages that need module-provided
 * shared libraries fail to link. These variables must be prepended instead.
 *
 * See https://github.com/posit-dev/positron/issues/15191.
 */
suite('Library path environment variables', () => {

	function createRuntimeMetadata(): positron.LanguageRuntimeMetadata {
		return {
			runtimePath: '/usr/lib/R/bin/R',
			runtimeId: '00000000-0000-0000-0000-000000000000',
			runtimeName: 'R 4.4',
			runtimeShortName: '4.4',
			runtimeVersion: '0.1',
			runtimeSource: 'Test',
			languageName: 'R',
			languageId: 'r',
			languageVersion: '4.4.0',
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

	function newSession(): KallichoreSession {
		return new KallichoreSession(
			createSessionMetadata(),
			createRuntimeMetadata(),
			{ sessionName: 'R 4.4', inputPrompt: '>', continuationPrompt: '+' },
			// `newSession` is the only API method exercised here (by `create`).
			{ newSession: async () => { /* no-op */ } } as unknown as DefaultApi,
			KallichoreTransport.TCP,
			async () => { /* server is assumed running */ },
			/* isNew */ true,
		);
	}

	test('library path variables are prepended, other variables are replaced', async () => {
		const session = newSession();
		const kernelSpec: JupyterKernelSpec = {
			argv: ['ark', '--connection_file', '{connection_file}'],
			display_name: 'R 4.4',
			language: 'r',
			kernel_protocol_version: '5.3',
			env: {
				// Injected by the R kernel spec (getArkEnvironmentVariables).
				LD_LIBRARY_PATH: '/opt/R/lib',
				DYLD_LIBRARY_PATH: '/opt/R/lib',
				// A regular scalar variable is unaffected.
				R_HOME: '/opt/R',
			},
		};
		await session.create(kernelSpec);
		try {
			const actions = await session.buildEnvVarActions(false);
			const relevant = actions.filter(
				a => a.name === 'LD_LIBRARY_PATH' ||
					a.name === 'DYLD_LIBRARY_PATH' ||
					a.name === 'R_HOME');

			// The library path variables prepend their value (with a trailing
			// delimiter so the existing entries stay separated); R_HOME replaces.
			assert.deepStrictEqual(relevant, [
				{ action: VarActionType.Prepend, name: 'LD_LIBRARY_PATH', value: '/opt/R/lib' + path.delimiter },
				{ action: VarActionType.Prepend, name: 'DYLD_LIBRARY_PATH', value: '/opt/R/lib' + path.delimiter },
				{ action: VarActionType.Replace, name: 'R_HOME', value: '/opt/R' },
			]);
		} finally {
			session.dispose();
		}
	});
});
