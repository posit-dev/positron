/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />
// @vitest-environment node

import type { HeadlessProviders, HeadlessProvidersOptions } from 'ai-provider-bridge/headless';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { Emitter } from '../../../../base/common/event.js';
import { join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import Severity from '../../../../base/common/severity.js';
import {
	DidUninstallExtensionEvent,
	IExtensionManagementService,
	ILocalExtension,
	InstallExtensionResult,
} from '../../../extensionManagement/common/extensionManagement.js';
import { IProductService } from '../../../product/common/productService.js';
import { NullLogService } from '../../../log/common/log.js';
import { IUserDataProfile, IUserDataProfilesService } from '../../../userDataProfile/common/userDataProfile.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../test/vitest/vitestUtils.js';
import {
	findAssistantProviderModule,
	HeadlessProviderModule,
	selectProviders,
} from '../../node/headlessProviderModule.js';

const { compiledInFactory } = vi.hoisted(() => ({ compiledInFactory: vi.fn() }));
vi.mock('ai-provider-bridge/headless', () => ({ createHeadlessProviders: compiledInFactory }));

// Inside the repo because Vitest's module runner will not import files outside its root.
const FAKE_INSTALLS = fileURLToPath(new URL('../../../../../../.build/headless-provider-module-tests', import.meta.url));

const GOOD_MODULE = `export function createHeadlessProviders() { return { configPath: 'assistant', dispose() {} }; }\n`;

/** The module folder as it is reported: through `URI.fsPath`, which lowercases a Windows drive letter. */
function moduleFolder(root: string): string {
	return join(URI.file(root).fsPath, 'dist', 'provider-module');
}

function fakeProviders(tag: string): HeadlessProviders {
	return stubInterface<HeadlessProviders>({ configPath: tag, dispose: vi.fn() });
}

function tagOf(providers: HeadlessProviders): string {
	return providers.configPath;
}

describe('headless provider module', () => {
	ensureNoLeakedDisposables();

	const roots: string[] = [];
	const options: HeadlessProvidersOptions = {
		logger: { info() { }, warn() { }, error() { }, debug() { }, trace() { } },
		userAgent: 'Positron/headless',
		catalog: { envVars: {} },
	};

	function installFolder(indexSource: string | undefined): string {
		mkdirSync(FAKE_INSTALLS, { recursive: true });
		const root = mkdtempSync(join(FAKE_INSTALLS, 'assistant-'));
		roots.push(root);
		const folder = join(root, 'dist', 'provider-module');
		mkdirSync(folder, { recursive: true });
		if (indexSource !== undefined) {
			writeFileSync(join(folder, 'package.json'), '{ "type": "module" }');
			writeFileSync(join(folder, 'index.js'), indexSource);
		}
		return root;
	}

	function extension(root: string, version: string, isValid = true, id = 'posit.assistant'): ILocalExtension {
		return stubInterface<ILocalExtension>({
			identifier: { id },
			location: URI.file(root),
			manifest: stubInterface<ILocalExtension['manifest']>({ version }),
			isValid,
			validations: isValid ? [] : [[Severity.Error, 'engines.positron mismatch']],
		});
	}

	function profiles(...names: string[]): IUserDataProfilesService {
		return stubInterface<IUserDataProfilesService>({
			profiles: names.map(name => stubInterface<IUserDataProfile>({
				extensionsResource: URI.file(`/profiles/${name}/extensions.json`),
			})),
		});
	}

	const installs = new Emitter<readonly InstallExtensionResult[]>();
	const uninstalls = new Emitter<DidUninstallExtensionEvent>();

	function extensionsByProfile(byProfile: Record<string, ILocalExtension[] | Error>): IExtensionManagementService {
		return stubInterface<IExtensionManagementService>({
			onDidInstallExtensions: installs.event,
			onDidUninstallExtension: uninstalls.event,
			getInstalled: vi.fn(async (_type, resource: URI) => {
				const name = resource.path.split('/')[2];
				const result = byProfile[name] ?? [];
				if (result instanceof Error) {
					throw result;
				}
				return result;
			}),
		});
	}

	function product(bundledVersion?: string): IProductService {
		return stubInterface<IProductService>({
			bootstrapExtensions: bundledVersion === undefined
				? undefined
				: [{ name: 'posit.assistant', version: bundledVersion }],
		});
	}

	function loader(tag = 'compiled-in') {
		return vi.fn(async () => ({ createHeadlessProviders: () => fakeProviders(tag) }));
	}

	function select(
		extensions: IExtensionManagementService,
		productService: IProductService,
		loadCompiledIn: Parameters<typeof selectProviders>[4] = loader(),
		profileService = profiles('default'),
	) {
		return selectProviders(extensions, profileService, productService, options, loadCompiledIn, new NullLogService());
	}

	afterEach(() => {
		while (roots.length) {
			rmSync(roots.pop()!, { recursive: true, force: true });
		}
	});

	describe('findAssistantProviderModule', () => {
		it('reports Assistant as not installed', async () => {
			const result = await findAssistantProviderModule(extensionsByProfile({}), profiles('default'));
			expect(result).toEqual({ reason: 'Posit Assistant is not installed' });
		});

		it('matches the id case-insensitively and returns the module folder', async () => {
			const root = installFolder(GOOD_MODULE);
			const result = await findAssistantProviderModule(
				extensionsByProfile({ default: [extension(root, '1.2.0', true, 'Posit.Assistant')] }),
				profiles('default'),
			);
			expect(result).toEqual({ folder: moduleFolder(root), version: '1.2.0' });
		});

		it('ignores other extensions', async () => {
			const root = installFolder(GOOD_MODULE);
			const result = await findAssistantProviderModule(
				extensionsByProfile({ default: [extension(root, '1.2.0', true, 'posit.other')] }),
				profiles('default'),
			);
			expect(result).toEqual({ reason: 'Posit Assistant is not installed' });
		});

		it('finds Assistant installed only in a non-default profile', async () => {
			const root = installFolder(GOOD_MODULE);
			const result = await findAssistantProviderModule(
				extensionsByProfile({ work: [extension(root, '1.0.0')] }),
				profiles('default', 'work'),
			);
			expect(result).toMatchObject({ version: '1.0.0' });
		});

		it('returns the newest version across profiles', async () => {
			const older = installFolder(GOOD_MODULE);
			const newer = installFolder(GOOD_MODULE);
			const result = await findAssistantProviderModule(
				extensionsByProfile({ default: [extension(older, '1.9.0')], work: [extension(newer, '1.10.0')] }),
				profiles('default', 'work'),
			);
			expect(result).toEqual({ folder: moduleFolder(newer), version: '1.10.0' });
		});

		it('prefers an older valid copy over a newer invalid one', async () => {
			const valid = installFolder(GOOD_MODULE);
			const invalid = installFolder(GOOD_MODULE);
			const result = await findAssistantProviderModule(
				extensionsByProfile({ default: [extension(invalid, '2.0.0', false)], work: [extension(valid, '1.0.0')] }),
				profiles('default', 'work'),
			);
			expect(result).toEqual({ folder: moduleFolder(valid), version: '1.0.0' });
		});

		it('explains when only invalid copies are installed', async () => {
			const root = installFolder(GOOD_MODULE);
			const result = await findAssistantProviderModule(
				extensionsByProfile({ default: [extension(root, '2.0.0', false)] }),
				profiles('default'),
			);
			expect(result).toEqual({
				reason: 'No installed Posit Assistant is compatible with this Positron: 2.0.0: engines.positron mismatch',
			});
		});
	});

	describe('selectProviders', () => {
		it('serves from Assistant without touching the compiled-in copy', async () => {
			const root = installFolder(GOOD_MODULE);
			const loadCompiledIn = vi.fn(() => Promise.reject(new Error('compiled-in is broken')));
			const { providers, source } = await select(
				extensionsByProfile({ default: [extension(root, '1.1.0')] }),
				product('1.0.0'),
				loadCompiledIn,
			);
			expect({ tag: tagOf(providers), source, loads: loadCompiledIn.mock.calls.length }).toEqual({
				tag: 'assistant',
				source: { kind: 'assistant', folder: moduleFolder(root) },
				loads: 0,
			});
		});

		it('falls back when the installed version is not newer than the bundled one', async () => {
			const root = installFolder(GOOD_MODULE);
			const { providers, source } = await select(
				extensionsByProfile({ default: [extension(root, '1.0.0')] }),
				product('1.0.0'),
			);
			expect({ tag: tagOf(providers), source }).toEqual({
				tag: 'compiled-in',
				source: { kind: 'compiled-in', reason: 'Posit Assistant 1.0.0 is not newer than the bundled 1.0.0' },
			});
		});

		it('falls back with the not-installed reason', async () => {
			const { source } = await select(extensionsByProfile({}), product());
			expect(source).toEqual({ kind: 'compiled-in', reason: 'Posit Assistant is not installed' });
		});

		it('falls back when index.js is missing', async () => {
			const root = installFolder(undefined);
			const { source } = await select(extensionsByProfile({ default: [extension(root, '1.0.0')] }), product());
			expect(source).toMatchObject({ kind: 'compiled-in', reason: expect.stringContaining('index.js') });
		});

		it('falls back when the factory export is missing', async () => {
			const root = installFolder('export const other = 1;\n');
			const { source } = await select(extensionsByProfile({ default: [extension(root, '1.0.0')] }), product());
			expect(source).toMatchObject({
				kind: 'compiled-in',
				reason: expect.stringContaining('missing createHeadlessProviders export'),
			});
		});

		it('falls back when the factory throws', async () => {
			const root = installFolder('export function createHeadlessProviders() { throw new Error("boom"); }\n');
			const { source } = await select(extensionsByProfile({ default: [extension(root, '1.0.0')] }), product());
			expect(source).toMatchObject({ kind: 'compiled-in', reason: expect.stringContaining('boom') });
		});

		it('falls back when listing installed extensions rejects', async () => {
			const { source } = await select(extensionsByProfile({ default: new Error('scan failed') }), product());
			expect(source).toMatchObject({ kind: 'compiled-in', reason: expect.stringContaining('scan failed') });
		});

		it('propagates a throw from the compiled-in factory', async () => {
			const loadCompiledIn = async () => ({
				createHeadlessProviders: () => { throw new Error('compiled-in factory failed'); },
			});
			await expect(select(extensionsByProfile({}), product(), loadCompiledIn)).rejects.toThrow('compiled-in factory failed');
		});
	});

	describe('HeadlessProviderModule', () => {
		function create(extensions: IExtensionManagementService, productService = product()) {
			const module = new HeadlessProviderModule(extensions, profiles('default'), productService, new NullLogService());
			return module;
		}

		beforeEach(() => {
			compiledInFactory.mockImplementation(() => fakeProviders('compiled-in'));
		});

		it('runs discovery once and shares the instance across concurrent calls', async () => {
			const root = installFolder(GOOD_MODULE);
			const extensions = extensionsByProfile({ default: [extension(root, '1.0.0')] });
			const module = create(extensions);
			const [a, b] = await Promise.all([module.get(), module.get()]);
			expect(a.providers).toBe(b.providers);
			expect(extensions.getInstalled).toHaveBeenCalledTimes(1);
			module.dispose();
		});

		it('retries after the compiled-in factory throws', async () => {
			compiledInFactory.mockImplementationOnce(() => { throw new Error('first failure'); });
			const module = create(extensionsByProfile({}));
			await expect(module.get()).rejects.toThrow('first failure');
			const { source } = await module.get();
			expect(source.kind).toBe('compiled-in');
			module.dispose();
		});

		it('passes the Positron user agent to the factory', async () => {
			const module = create(extensionsByProfile({}));
			await module.get();
			expect(compiledInFactory.mock.calls[0][0]).toMatchObject({ userAgent: 'Positron/headless' });
			module.dispose();
		});

		it('disposes the selected providers exactly once', async () => {
			const module = create(extensionsByProfile({}));
			const { providers } = await module.get();
			module.dispose();
			module.dispose();
			await vi.waitFor(() => expect(providers.dispose).toHaveBeenCalledTimes(1));
		});

		it('disposes providers that resolve after dispose', async () => {
			const module = create(extensionsByProfile({}));
			const pending = module.get();
			module.dispose();
			const { providers } = await pending;
			await vi.waitFor(() => expect(providers.dispose).toHaveBeenCalledTimes(1));
		});

		it('does not rerun selection when disposed after a rejected get', async () => {
			compiledInFactory.mockImplementationOnce(() => { throw new Error('first failure'); });
			const extensions = extensionsByProfile({});
			const module = create(extensions);
			await expect(module.get()).rejects.toThrow('first failure');
			module.dispose();
			await new Promise(resolve => setTimeout(resolve, 0));
			expect({ discoveries: vi.mocked(extensions.getInstalled).mock.calls.length, factories: compiledInFactory.mock.calls.length })
				.toEqual({ discoveries: 1, factories: 1 });
		});

		it('selects again and keeps the old providers alive when Posit Assistant is installed', async () => {
			const installed: ILocalExtension[] = [];
			const module = create(extensionsByProfile({ default: installed }));
			const reselected = vi.fn();
			const listener = module.onDidReselect(reselected);
			const before = await module.get();
			installed.push(extension(installFolder(GOOD_MODULE), '1.0.0'));
			installs.fire([stubInterface<InstallExtensionResult>({ identifier: { id: 'Posit.Assistant' } })]);
			const after = await module.get();
			expect({ before: before.source.kind, after: after.source.kind, reselects: reselected.mock.calls.length })
				.toEqual({ before: 'compiled-in', after: 'assistant', reselects: 1 });
			expect(before.providers.dispose).not.toHaveBeenCalled();
			listener.dispose();
			module.dispose();
		});

		it('selects again when Posit Assistant is uninstalled', async () => {
			const module = create(extensionsByProfile({}));
			const before = await module.get();
			uninstalls.fire(stubInterface<DidUninstallExtensionEvent>({ identifier: { id: 'posit.assistant' } }));
			expect(await module.get()).not.toBe(before);
			module.dispose();
		});

		it('ignores install and uninstall events for other extensions', async () => {
			const module = create(extensionsByProfile({}));
			const before = await module.get();
			installs.fire([stubInterface<InstallExtensionResult>({ identifier: { id: 'posit.other' } })]);
			uninstalls.fire(stubInterface<DidUninstallExtensionEvent>({ identifier: { id: 'posit.other' } }));
			expect(await module.get()).toBe(before);
			expect(before.providers.dispose).not.toHaveBeenCalled();
			module.dispose();
		});

		it('rejects get after dispose without creating providers', async () => {
			const extensions = extensionsByProfile({});
			const module = create(extensions);
			module.dispose();
			await expect(module.get()).rejects.toThrow('disposed');
			expect({ discoveries: vi.mocked(extensions.getInstalled).mock.calls.length, factories: compiledInFactory.mock.calls.length })
				.toEqual({ discoveries: 0, factories: 0 });
		});
	});
});
