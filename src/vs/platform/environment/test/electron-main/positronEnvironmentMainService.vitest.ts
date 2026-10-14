/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import product from '../../../product/common/product.js';
import { EnvironmentMainService } from '../../electron-main/environmentMainService.js';
import { OPTIONS, parseArgs } from '../../node/argv.js';

function isPortable(): boolean {
	return new EnvironmentMainService(parseArgs([], OPTIONS), { _serviceBrand: undefined, ...product }).isPortable;
}

describe('EnvironmentMainService.isPortable', () => {
	beforeEach(() => {
		vi.stubEnv('POSITRON_PORTABLE', undefined);
		vi.stubEnv('VSCODE_PORTABLE', undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	test('is true when only POSITRON_PORTABLE is set', () => {
		vi.stubEnv('POSITRON_PORTABLE', '/tmp/positron-portable');

		expect(isPortable()).toBe(true);
	});

	test('is false when neither variable is set', () => {
		expect(isPortable()).toBe(false);
	});
});
