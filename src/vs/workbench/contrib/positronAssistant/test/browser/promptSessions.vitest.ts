/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { getForegroundSessionInfo } from '../../browser/prompts/promptSessions.js';

/** Build a runtime session service whose foreground session has the given metadata (or none). */
function runtimeSessionServiceWith(metadata?: { languageId: string; languageName: string; runtimeName: string }): IRuntimeSessionService {
	const foregroundSession = metadata
		? stubInterface<ILanguageRuntimeSession>({
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>(metadata),
		})
		: undefined;
	return stubInterface<IRuntimeSessionService>({ foregroundSession });
}

describe('getForegroundSessionInfo', () => {
	it('reflects the currently selected (foreground) session', () => {
		const info = getForegroundSessionInfo(runtimeSessionServiceWith({ languageId: 'r', languageName: 'R', runtimeName: 'R 4.4.1' }));

		// Drives hasRSession/hasPythonSession for the correct language.
		expect(info.sessions).toEqual([{ languageId: 'r' }]);
		// Explicitly names the runtime so the model executes code in it.
		expect(info.contextFragment).toContain('R session');
		expect(info.contextFragment).toContain('R 4.4.1');
	});

	it('names the Python runtime when Python is selected', () => {
		const info = getForegroundSessionInfo(runtimeSessionServiceWith({ languageId: 'python', languageName: 'Python', runtimeName: 'Python 3.12.1' }));

		expect(info.sessions).toEqual([{ languageId: 'python' }]);
		expect(info.contextFragment).toContain('Python session');
	});

	it('returns no sessions or context when nothing is selected', () => {
		const info = getForegroundSessionInfo(runtimeSessionServiceWith(undefined));

		expect(info.sessions).toEqual([]);
		expect(info.contextFragment).toBeUndefined();
	});
});
