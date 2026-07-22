/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { activeEditorSupportsMissingPackages } from '../../browser/missingPackagesContextKey.js';

describe('activeEditorSupportsMissingPackages', () => {
	const sessionWithCapability = stubInterface<ILanguageRuntimeSession>({ listMissingPackages: async () => [] });
	const sessionWithoutCapability = stubInterface<ILanguageRuntimeSession>({ listMissingPackages: undefined });

	it('is false when there is no active language', () => {
		expect(activeEditorSupportsMissingPackages(undefined, undefined)).toBe(false);
	});

	it('is true for a Quarto document regardless of session', () => {
		expect(activeEditorSupportsMissingPackages('quarto', undefined)).toBe(true);
	});

	it('is true when the active language has a session that supports missing packages', () => {
		expect(activeEditorSupportsMissingPackages('anything', sessionWithCapability)).toBe(true);
	});

	it('is false when the active language session does not support missing packages', () => {
		expect(activeEditorSupportsMissingPackages('anything', sessionWithoutCapability)).toBe(false);
	});
});
