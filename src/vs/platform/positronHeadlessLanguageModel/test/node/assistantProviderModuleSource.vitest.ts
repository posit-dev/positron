/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import { join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../log/common/log.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { IExtensionManagementService, IGlobalExtensionEnablementService, ILocalExtension } from '../../../extensionManagement/common/extensionManagement.js';
import { findAssistantProviderModule } from '../../node/assistantProviderModuleSource.js';
import { loadProviderModule } from '../../node/providerModuleLoader.js';

/**
 * Shaped like a bootstrap-installed posit.assistant: bootstrap installs
 * through the same IExtensionManagementService.install() path as a manual
 * VSIX (positronBootstrapExtensionsInitializer.ts), so it surfaces through
 * getInstalled() identically -- there is no separate "bootstrap" extension
 * type to detect.
 */
function localExtension(id: string, location: string): ILocalExtension {
	return stubInterface<ILocalExtension>({
		identifier: { id },
		location: URI.file(location),
	});
}

describe('findAssistantProviderModule', () => {
	it('finds a bootstrap-installed Assistant the same way as a manual install', async () => {
		const extensions = stubInterface<IExtensionManagementService>({
			getInstalled: async () => [localExtension('posit.assistant', '/extensions/posit.assistant-1.5.0')],
		});
		const enablement = stubInterface<IGlobalExtensionEnablementService>({ getDisabledExtensions: () => [] });

		const source = await findAssistantProviderModule(extensions, enablement);

		expect(source?.enabled).toBe(true);
		expect(source?.folder.endsWith('provider-module')).toBe(true);
	});

	it('returns undefined when no extension matches posit.assistant', async () => {
		const extensions = stubInterface<IExtensionManagementService>({
			getInstalled: async () => [localExtension('some.other-extension', '/extensions/some.other-extension')],
		});
		const enablement = stubInterface<IGlobalExtensionEnablementService>({ getDisabledExtensions: () => [] });

		const source = await findAssistantProviderModule(extensions, enablement);

		expect(source).toBeUndefined();
	});

	it('reports disabled when the global enablement service lists posit.assistant', async () => {
		const extensions = stubInterface<IExtensionManagementService>({
			getInstalled: async () => [localExtension('posit.assistant', '/extensions/posit.assistant-1.5.0')],
		});
		const enablement = stubInterface<IGlobalExtensionEnablementService>({
			getDisabledExtensions: () => [{ id: 'posit.assistant' }],
		});

		const source = await findAssistantProviderModule(extensions, enablement);

		expect(source?.enabled).toBe(false);
	});

	it('falls back to the built-in copy when a real install has no provider-module folder yet', async () => {
		// Today's actual state: Assistant is bootstrap-installed but doesn't
		// ship dist/provider-module, so a real environment exercises the
		// "found, but nothing loadable" path, not the "not installed" path.
		const dir = fs.mkdtempSync(join(os.tmpdir(), 'assistant-install-'));
		const extensions = stubInterface<IExtensionManagementService>({
			getInstalled: async () => [localExtension('posit.assistant', dir)],
		});
		const enablement = stubInterface<IGlobalExtensionEnablementService>({ getDisabledExtensions: () => [] });
		const logService = stubInterface<ILogService>({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

		const source = await findAssistantProviderModule(extensions, enablement);
		const loaded = await loadProviderModule(source, logService);

		expect(loaded.ProviderRegistry).toBeDefined();
		expect((logService.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatch(/Ignoring/);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
