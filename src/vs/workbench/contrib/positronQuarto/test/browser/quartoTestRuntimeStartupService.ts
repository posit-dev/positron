/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

/**
 * A runtime startup service reporting a language runtime provider for each of
 * the given languages. A Quarto cell's language is executable, and so eligible
 * to be the document's primary language, only when an extension provides
 * runtimes for it.
 */
export function createTestRuntimeStartupService(languageIds: string[] = ['python', 'r']): IRuntimeStartupService {
	return stubInterface<IRuntimeStartupService>({
		hasLanguageRuntimeProvider: (languageId: string) => languageIds.includes(languageId),
	});
}
