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

	// PROVIDER-SETTINGS-MIGRATION(legacy-positron) gate: delete this block with
	// the loader option.
	describe('legacyPositronSettings pass-through', () => {
		function readerOf(values: Record<string, unknown>) {
			return {
				get: (key: string) => values[key],
				watch: () => ({ dispose: () => { } }),
			};
		}

		it('surfaces legacy settings in the catalog (below the user file)', async () => {
			const configPath = join(dir, 'providers.json');
			fs.writeFileSync(configPath, JSON.stringify({
				version: 1,
				providers: { openai: { baseUrl: 'https://user-openai.example/v1' } },
			}));
			catalog = new AiProviderCatalog(new NullLogService(), {
				configPath,
				envVars: {},
				legacyPositronSettings: readerOf({
					'authentication.anthropic.baseUrl': 'https://legacy.example/v1',
					'authentication.openai-api.baseUrl': 'https://legacy-openai.example/v1',
				}),
			});
			const providers = await catalog.getCatalog();
			// Legacy contributes anthropic; the user file wins for openai.
			expect(providers.find(p => p.id === 'anthropic')?.connection.baseUrl)
				.toBe('https://legacy.example/v1');
			expect(providers.find(p => p.id === 'openai')?.connection.baseUrl)
				.toBe('https://user-openai.example/v1');
		});

		it('POSITRON_ENFORCED_SETTINGS beats the user file', async () => {
			const configPath = join(dir, 'providers.json');
			fs.writeFileSync(configPath, JSON.stringify({
				version: 1,
				providers: { anthropic: { enabled: true, baseUrl: 'https://user.example/v1' } },
			}));
			catalog = new AiProviderCatalog(new NullLogService(), {
				configPath,
				envVars: {
					POSITRON_ENFORCED_SETTINGS: JSON.stringify({
						'authentication.anthropic.baseUrl': 'https://enforced.example/v1',
						'positron.assistant.provider.anthropic.enable': false,
					}),
				},
				legacyPositronSettings: readerOf({}),
			});
			const anthropic = (await catalog.getCatalog()).find(p => p.id === 'anthropic')!;
			expect({ enabled: anthropic.enabled, baseUrl: anthropic.connection.baseUrl })
				.toEqual({ enabled: false, baseUrl: 'https://enforced.example/v1' });
		});

		it('no reader → no legacy layers, even with the env var set', async () => {
			const configPath = join(dir, 'providers.json');
			catalog = new AiProviderCatalog(new NullLogService(), {
				configPath,
				envVars: {
					POSITRON_ENFORCED_SETTINGS: JSON.stringify({
						'authentication.anthropic.baseUrl': 'https://enforced.example/v1',
					}),
				},
			});
			const anthropic = (await catalog.getCatalog()).find(p => p.id === 'anthropic')!;
			expect(anthropic.connection.baseUrl).toBeUndefined();
		});
	});
});
