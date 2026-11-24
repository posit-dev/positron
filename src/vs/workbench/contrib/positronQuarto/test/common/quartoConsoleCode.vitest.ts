/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { prepareQuartoConsoleCode } from '../../common/quartoConsoleCode.js';
import { IQuartoExecutionManager } from '../../common/quartoExecutionTypes.js';

describe('prepareQuartoConsoleCode', () => {
	const documentUri = URI.file('/doc.qmd');

	/**
	 * Runs one case: the language's console session (live, exited, or none), the
	 * session the caller asked for, and whether preparing changes the code. Returns
	 * the result along with the session the code was prepared for.
	 */
	async function run(consoleSession: 'live' | 'exited' | 'none', changesCode: boolean, askedSessionId?: string) {
		const session = consoleSession === 'none' ? undefined : stubInterface<ILanguageRuntimeSession>({
			sessionId: 'console-1',
			getRuntimeState: () => consoleSession === 'live' ? RuntimeState.Idle : RuntimeState.Exited,
		});
		let preparedFor: string | undefined = 'not called';
		const result = await prepareQuartoConsoleCode(documentUri, 3, 'SELECT 1', 'ggsql', askedSessionId, {
			quartoExecutionManager: stubInterface<IQuartoExecutionManager>({
				consoleCode: async (_uri, _line, code, sessionId) => {
					preparedFor = sessionId;
					return changesCode ? `-- @connect: duckdb://a.db\n${code}` : code;
				},
			}),
			runtimeSessionService: stubInterface<IRuntimeSessionService>({
				getConsoleSessionForLanguage: () => session,
			}),
		});
		return { preparedFor, pinned: result.sessionId, prepended: result.code !== 'SELECT 1' };
	}

	it('pins only code it changed, to the live session it was prepared for, and never to an exited one', async () => {
		expect([
			// given a preamble: pinned to the live session the preamble was decided for
			await run('live', true),
			// unchanged (any language but ggsql, or a session already on the database): left to the console service
			await run('live', false),
			// an exited session is no session: prepared for none, so never pinned to it
			await run('exited', true),
			await run('exited', false),
			// no console session yet: the console service starts one
			await run('none', true),
			// a session the caller asked for is kept, and prepared for
			await run('exited', true, 'asked'),
			await run('live', false, 'asked'),
		]).toEqual([
			{ preparedFor: 'console-1', pinned: 'console-1', prepended: true },
			{ preparedFor: 'console-1', pinned: undefined, prepended: false },
			{ preparedFor: undefined, pinned: undefined, prepended: true },
			{ preparedFor: undefined, pinned: undefined, prepended: false },
			{ preparedFor: undefined, pinned: undefined, prepended: true },
			{ preparedFor: 'asked', pinned: 'asked', prepended: true },
			{ preparedFor: 'asked', pinned: 'asked', prepended: false },
		]);
	});
});
