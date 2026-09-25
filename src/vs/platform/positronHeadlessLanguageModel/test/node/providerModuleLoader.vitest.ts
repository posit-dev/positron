/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import { join } from '../../../../base/common/path.js';
import { ILogService } from '../../../log/common/log.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { assertProviderModuleShape, loadProviderModule, ProviderModule } from '../../node/providerModuleLoader.js';

function testLogger() {
	return stubInterface<ILogService>({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
}

describe('loadProviderModule', () => {
	it('falls back to the built-in copy when Assistant is not installed', async () => {
		const logService = testLogger();

		const loaded = await loadProviderModule(undefined, logService);

		expect(loaded.ProviderRegistry).toBeDefined();
		expect(logService.warn).not.toHaveBeenCalled();
	});

	it('falls back to the built-in copy when the module file is missing', async () => {
		const dir = fs.mkdtempSync(join(os.tmpdir(), 'provider-module-'));
		const logService = testLogger();

		const loaded = await loadProviderModule({ folder: dir, enabled: true }, logService);

		expect(loaded.ProviderRegistry).toBeDefined();
		expect((logService.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatch(/Ignoring/);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('rejects a module missing an expected export', () => {
		const incomplete: Partial<ProviderModule> = { ProviderRegistry: class { } };
		expect(() => assertProviderModuleShape(incomplete)).toThrow(/missing export\(s\).*registerAllProviders/);
	});

	it('falls back to the built-in copy when Assistant is disabled', async () => {
		const logService = testLogger();

		const loaded = await loadProviderModule({ folder: '/unused', enabled: false }, logService);

		expect(loaded.ProviderRegistry).toBeDefined();
		expect((logService.info as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatch(/disabled/);
	});
});
