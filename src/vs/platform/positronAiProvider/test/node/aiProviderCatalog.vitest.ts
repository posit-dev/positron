/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import { NullLogService } from '../../../log/common/log.js';
import { join } from '../../../../base/common/path.js';
import { AiProviderCatalog } from '../../node/aiProviderCatalog.js';

describe('AiProviderCatalog', () => {
	let dir: string;
	let catalog: AiProviderCatalog;

	beforeEach(() => {
		dir = fs.mkdtempSync(join(os.tmpdir(), 'ai-provider-catalog-'));
	});
	afterEach(() => {
		catalog?.dispose();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('resolves the baseline catalog when no file exists (default enabled)', async () => {
		catalog = new AiProviderCatalog(new NullLogService(), {
			configPath: join(dir, 'providers.json'), envVars: {},
		});
		const providers = await catalog.getCatalog();
		expect(providers.length).toBeGreaterThan(0);
		expect(providers.every(p => p.enabled)).toBe(true);
	});

	it('reads enablement and connection from the file', async () => {
		const configPath = join(dir, 'providers.json');
		fs.writeFileSync(configPath, JSON.stringify({
			version: 1,
			providers: { anthropic: { enabled: false, baseUrl: 'https://proxy.example/v1' } },
		}));
		catalog = new AiProviderCatalog(new NullLogService(), { configPath, envVars: {} });
		const anthropic = (await catalog.getCatalog()).find(p => p.id === 'anthropic')!;
		expect({ enabled: anthropic.enabled, baseUrl: anthropic.connection.baseUrl })
			.toEqual({ enabled: false, baseUrl: 'https://proxy.example/v1' });
	});

	it('emits a change event when the file changes', async () => {
		const configPath = join(dir, 'providers.json');
		fs.writeFileSync(configPath, JSON.stringify({ version: 1, providers: {} }));
		catalog = new AiProviderCatalog(new NullLogService(), { configPath, envVars: {} });
		await catalog.getCatalog();
		const changed = new Promise<void>(resolve => {
			const d = catalog.onDidChangeCatalog(e => {
				expect(e.enabledChanged).toBe(true);
				d.dispose();
				resolve();
			});
		});
		fs.writeFileSync(configPath, JSON.stringify({
			version: 1, providers: { anthropic: { enabled: false } },
		}));
		await changed;      // ai-config debounces ~300ms; vitest default timeout covers it
		const anthropic = (await catalog.getCatalog()).find(p => p.id === 'anthropic')!;
		expect(anthropic.enabled).toBe(false);
	}, 10_000);

	it('tears the watcher down on dispose', async () => {
		const configPath = join(dir, 'providers.json');
		catalog = new AiProviderCatalog(new NullLogService(), { configPath, envVars: {} });
		await catalog.getCatalog();
		const fired = vi.fn();
		catalog.onDidChangeCatalog(fired);
		catalog.dispose();
		fs.writeFileSync(configPath, JSON.stringify({ version: 1, providers: { anthropic: { enabled: false } } }));
		await new Promise(r => setTimeout(r, 600));
		expect(fired).not.toHaveBeenCalled();
	}, 10_000);
});
