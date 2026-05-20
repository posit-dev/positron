/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IConfigurationService, IConfigurationValue } from '../../../../../../platform/configuration/common/configuration.js';
import { isFileExcludedFromAI } from '../../../browser/tools/utils.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';

const AI_KEY = 'positron.assistant.aiExcludes';
const INLINE_KEY = 'positron.assistant.inlineCompletionExcludes';

interface SettingState {
	userValue?: string[];
	workspaceValue?: string[];
	/** Value `getValue()` should return -- contributed default for stock config, or the user value. */
	value?: string[];
}

function makeService(ai: SettingState = {}, inline: SettingState = {}): IConfigurationService {
	return stubInterface<IConfigurationService>({
		inspect: <T,>(key: string): IConfigurationValue<T> => {
			const s = key === AI_KEY ? ai : key === INLINE_KEY ? inline : {};
			const result: IConfigurationValue<string[]> = {
				userValue: s.userValue,
				workspaceValue: s.workspaceValue,
			};
			return result as IConfigurationValue<T>;
		},
		getValue: <T,>(key: string | undefined): T => {
			const s = key === AI_KEY ? ai : key === INLINE_KEY ? inline : {};
			return s.value as T;
		},
	});
}

describe('isFileExcludedFromAI', () => {
	it('returns false when no patterns are configured', () => {
		const svc = makeService({ value: [] });
		expect(isFileExcludedFromAI(svc, '/project/file.py')).toBe(false);
	});

	it('returns false when patterns is undefined', () => {
		const svc = makeService();
		expect(isFileExcludedFromAI(svc, '/project/file.py')).toBe(false);
	});

	describe('basename matching (patterns without /)', () => {
		it('*.py matches a Python file at any depth', () => {
			const svc = makeService({ userValue: ['*.py'], value: ['*.py'] });
			expect(isFileExcludedFromAI(svc, '/project/src/deep/file.py')).toBe(true);
			expect(isFileExcludedFromAI(svc, '/project/file.js')).toBe(false);
		});
	});

	describe('path matching (patterns with /)', () => {
		it('**/.git/** matches files inside .git', () => {
			const svc = makeService({ userValue: ['**/.git/**'], value: ['**/.git/**'] });
			expect(isFileExcludedFromAI(svc, '/project/.git/config')).toBe(true);
			expect(isFileExcludedFromAI(svc, '/project/src/file.ts')).toBe(false);
		});
	});

	describe('fallback to inlineCompletionExcludes', () => {
		it('uses inlineCompletionExcludes when only the deprecated key is explicitly set', () => {
			const svc = makeService(
				{ value: ['*.py'] },
				{ userValue: ['*.env'], value: ['*.env'] },
			);
			expect(isFileExcludedFromAI(svc, '/project/.env')).toBe(true);
			expect(isFileExcludedFromAI(svc, '/project/file.py')).toBe(false);
		});

		it('does NOT use inlineCompletionExcludes when neither key is explicitly set (stock config -- #13544)', () => {
			// Both stock: getValue returns each key's contributed default, but
			// neither userValue / workspaceValue is set. Must read aiExcludes.
			const svc = makeService(
				{ value: ['**/.env'] },
				{ value: ['**/.*'] },
			);
			expect(isFileExcludedFromAI(svc, '/project/.env')).toBe(true);
			expect(isFileExcludedFromAI(svc, '/project/.github/foo.yml')).toBe(false);
		});

		it('honors workspaceValue (not just userValue) as "explicitly set"', () => {
			const svc = makeService(
				{ workspaceValue: ['*.py'], value: ['*.py'] },
				{ userValue: ['*.env'], value: ['*.env'] },
			);
			expect(isFileExcludedFromAI(svc, '/project/file.py')).toBe(true);
			expect(isFileExcludedFromAI(svc, '/project/.env')).toBe(false);
		});
	});

	it('honors an explicit empty array as "exclude nothing" (does not fall through to deprecated)', () => {
		const svc = makeService(
			{ userValue: [], value: [] },
			{ userValue: ['**/.env'], value: ['**/.env'] },
		);
		expect(isFileExcludedFromAI(svc, '/project/.env')).toBe(false);
	});
});
