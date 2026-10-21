/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import type { HeadlessCatalogChange, HeadlessProviderData, HeadlessProviders } from 'ai-provider-bridge/headless';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { IExtensionManagementService } from '../../../extensionManagement/common/extensionManagement.js';
import { NullLogService } from '../../../log/common/log.js';
import { HeadlessProviderModule } from '../../../positronHeadlessLanguageModel/node/headlessProviderModule.js';
import { IProductService } from '../../../product/common/productService.js';
import { IUserDataProfile, IUserDataProfilesService } from '../../../userDataProfile/common/userDataProfile.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { IProviderCatalogChangeData } from '../../common/aiProviderCatalog.js';
import { AiProviderCatalog } from '../../node/aiProviderCatalog.js';

describe('AiProviderCatalog', () => {
	let dir: string;
	let module: HeadlessProviderModule | undefined;
	let catalog: AiProviderCatalog | undefined;

	beforeEach(() => {
		dir = fs.mkdtempSync(join(os.tmpdir(), 'ai-provider-catalog-'));
	});
	afterEach(() => {
		catalog?.dispose();
		module?.dispose();
		catalog = undefined;
		module = undefined;
		fs.rmSync(dir, { recursive: true, force: true });
	});

	/** A catalog over the compiled-in provider module: no Assistant is installed. */
	function createCatalog(configPath: string, envVars: Record<string, string> = {}): AiProviderCatalog {
		module = new HeadlessProviderModule(
			stubInterface<IExtensionManagementService>({
				getInstalled: async () => [],
				onDidInstallExtensions: Event.None,
				onDidUninstallExtension: Event.None,
			}),
			stubInterface<IUserDataProfilesService>({
				profiles: [stubInterface<IUserDataProfile>({ extensionsResource: URI.file(join(dir, 'extensions.json')) })],
			}),
			stubInterface<IProductService>({}),
			new NullLogService(),
			{ configPath, envVars },
		);
		catalog = new AiProviderCatalog(module);
		return catalog;
	}

	function writeConfig(configPath: string, providers: object): void {
		fs.writeFileSync(configPath, JSON.stringify({ version: 1, providers }));
	}

	it('resolves the baseline catalog when no file exists (default enabled)', async () => {
		const providers = await createCatalog(join(dir, 'providers.json')).getCatalog();
		expect(providers.length).toBeGreaterThan(0);
		expect(providers.every(p => p.enabled)).toBe(true);
	});

	it('reads enablement, base URL and customized connection fields from the file', async () => {
		const configPath = join(dir, 'providers.json');
		writeConfig(configPath, { anthropic: { enabled: false, baseUrl: 'https://proxy.example/v1' } });
		const anthropic = (await createCatalog(configPath).getCatalog()).find(p => p.id === 'anthropic');
		expect(anthropic).toEqual({
			id: 'anthropic',
			enabled: false,
			baseUrl: 'https://proxy.example/v1',
			customizedConnection: ['baseUrl'],
		});
	});

	it('emits a change event when the file changes', async () => {
		const configPath = join(dir, 'providers.json');
		writeConfig(configPath, {});
		const created = createCatalog(configPath);
		await created.getCatalog();
		const changed = new Promise<boolean>(resolve => {
			const d = created.onDidChangeCatalog(e => {
				d.dispose();
				resolve(e.enabledChanged);
			});
		});
		writeConfig(configPath, { anthropic: { enabled: false } });
		expect(await changed).toBe(true);
		const anthropic = (await created.getCatalog()).find(p => p.id === 'anthropic');
		expect(anthropic?.enabled).toBe(false);
	}, 10_000);

	it('stops firing once disposed', async () => {
		const configPath = join(dir, 'providers.json');
		const created = createCatalog(configPath);
		await created.getCatalog();
		const fired = vi.fn();
		created.onDidChangeCatalog(fired);
		created.dispose();
		writeConfig(configPath, { anthropic: { enabled: false } });
		await new Promise(r => setTimeout(r, 600));
		expect(fired).not.toHaveBeenCalled();
	}, 10_000);

	it('returns the config file location as a file URI', async () => {
		const configPath = join(dir, 'providers.json');
		expect((await createCatalog(configPath).getConfigFileUri()).toString()).toBe(URI.file(configPath).toString());
	});

	// PROVIDER-SETTINGS-MIGRATION(legacy-positron) gate: the entry opts into the
	// legacy admin channel only; user-set legacy settings are never read.
	it('applies POSITRON_ENFORCED_SETTINGS above the user file', async () => {
		const configPath = join(dir, 'providers.json');
		writeConfig(configPath, { anthropic: { enabled: true, baseUrl: 'https://user.example/v1' } });
		const created = createCatalog(configPath, {
			POSITRON_ENFORCED_SETTINGS: JSON.stringify({
				'authentication.anthropic.baseUrl': 'https://enforced.example/v1',
				'positron.assistant.provider.anthropic.enable': false,
			}),
		});
		const anthropic = (await created.getCatalog()).find(p => p.id === 'anthropic');
		expect({ enabled: anthropic?.enabled, baseUrl: anthropic?.baseUrl })
			.toEqual({ enabled: false, baseUrl: 'https://enforced.example/v1' });
	});

	describe('over a fake provider module', () => {
		const stale: HeadlessProviderData[] = [{ id: 'anthropic', enabled: true }];
		const fresh: HeadlessProviderData[] = [{ id: 'anthropic', enabled: false }];

		function fakeProviders(getCatalog: () => Promise<readonly HeadlessProviderData[]>) {
			const listeners = new Set<(change: HeadlessCatalogChange) => void>();
			const providers = stubInterface<HeadlessProviders>({
				getCatalog,
				onDidChangeCatalog: listener => {
					listeners.add(listener);
					return { dispose: () => listeners.delete(listener) };
				},
			});
			const fire = (catalog: readonly HeadlessProviderData[]) => listeners.forEach(listener => listener({
				catalog, enabledChanged: true, connectionChanged: false, modelsChanged: false,
			}));
			return { providers, fire, listeners };
		}

		function catalogOver(get: HeadlessProviderModule['get'], onDidReselect: Event<void> = Event.None): AiProviderCatalog {
			catalog = new AiProviderCatalog(stubInterface<HeadlessProviderModule>({ get, onDidReselect }));
			return catalog;
		}

		it('emits one full change with the new catalog after the module selects again', async () => {
			const reselect = new Emitter<void>();
			const old = fakeProviders(async () => stale);
			let current = old;
			const created = catalogOver(async () => ({ providers: current.providers, source: { kind: 'compiled-in', reason: 'test' } }), reselect.event);
			await created.getCatalog();
			const changes: IProviderCatalogChangeData[] = [];
			created.onDidChangeCatalog(change => changes.push(change));
			current = fakeProviders(async () => fresh);
			reselect.fire();
			await vi.waitFor(() => expect(changes.length).toBe(1));
			old.fire(stale);
			expect({ changes, oldListeners: old.listeners.size }).toEqual({
				changes: [{ catalog: fresh, enabledChanged: true, connectionChanged: true, modelsChanged: true }],
				oldListeners: 0,
			});
			reselect.dispose();
		});

		it('keeps the new copy when the old selection resolves after the module selects again', async () => {
			const reselect = new Emitter<void>();
			const old = fakeProviders(async () => stale);
			const next = fakeProviders(async () => fresh);
			const oldSelection = new DeferredPromise<Awaited<ReturnType<HeadlessProviderModule['get']>>>();
			const get = vi.fn<HeadlessProviderModule['get']>()
				.mockReturnValueOnce(oldSelection.p)
				.mockResolvedValue({ providers: next.providers, source: { kind: 'compiled-in', reason: 'test' } });
			const created = catalogOver(get, reselect.event);
			const firstLoad = created.getCatalog();
			reselect.fire();
			await vi.waitFor(() => expect(next.listeners.size).toBe(1));
			oldSelection.complete({ providers: old.providers, source: { kind: 'compiled-in', reason: 'test' } });
			await firstLoad;
			old.fire(stale);
			expect({ catalog: await created.getCatalog(), oldListeners: old.listeners.size, newListeners: next.listeners.size })
				.toEqual({ catalog: fresh, oldListeners: 0, newListeners: 1 });
			reselect.dispose();
		});

		it('keeps a change that raced the initial load', async () => {
			const initial = new DeferredPromise<readonly HeadlessProviderData[]>();
			const fake = fakeProviders(() => initial.p);
			const created = catalogOver(async () => ({ providers: fake.providers, source: { kind: 'compiled-in', reason: 'test' } }));
			const loading = created.getCatalog();
			await vi.waitFor(() => expect(fake.listeners.size).toBe(1));
			fake.fire(fresh);
			initial.complete(stale);
			expect(await loading).toEqual(fresh);
		});

		it('retries after a failed load without subscribing twice', async () => {
			const getCatalog = vi.fn<() => Promise<readonly HeadlessProviderData[]>>()
				.mockRejectedValueOnce(new Error('providers.json unreadable'))
				.mockResolvedValue(stale);
			const fake = fakeProviders(getCatalog);
			const created = catalogOver(async () => ({ providers: fake.providers, source: { kind: 'compiled-in', reason: 'test' } }));
			await expect(created.getCatalog()).rejects.toThrow('providers.json unreadable');
			expect(await created.getCatalog()).toEqual(stale);
			expect(fake.listeners.size).toBe(1);
		});
	});
});
