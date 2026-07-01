/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { COPILOT_ENABLE_KEY, DEPRECATED_INLINE_COMPLETIONS_ENABLE_KEY, migrateInlineCompletionsEnablement } from '../../browser/inlineCompletionsMigration.js';

describe('migrateInlineCompletionsEnablement', () => {
	it('moves the deprecated value to github.copilot.enable and removes the old key', () => {
		const result = migrateInlineCompletionsEnablement({ '*': false, r: true }, () => undefined);

		expect(result).toEqual([
			[DEPRECATED_INLINE_COMPLETIONS_ENABLE_KEY, { value: undefined }],
			[COPILOT_ENABLE_KEY, { value: { '*': false, r: true } }],
		]);
	});

	it('merges over an existing github.copilot.enable value, deprecated value wins on conflicts', () => {
		const result = migrateInlineCompletionsEnablement(
			{ '*': false, r: true },
			key => key === COPILOT_ENABLE_KEY ? { python: false, r: false } : undefined,
		);

		// The deprecated value wins on the conflicting 'r' key; non-conflicting keys are preserved.
		expect(result).toEqual([
			[DEPRECATED_INLINE_COMPLETIONS_ENABLE_KEY, { value: undefined }],
			[COPILOT_ENABLE_KEY, { value: { python: false, '*': false, r: true } }],
		]);
	});

	it('does nothing when the deprecated setting is unset', () => {
		expect(migrateInlineCompletionsEnablement(undefined, () => undefined)).toEqual([]);
	});

	it('does nothing when the deprecated setting is an empty object', () => {
		expect(migrateInlineCompletionsEnablement({}, () => undefined)).toEqual([]);
	});
});
