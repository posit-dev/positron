/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import {
	ILanguageRuntimeMetadata,
	LanguageRuntimeSessionLocation,
	LanguageRuntimeStartupBehavior,
} from '../../../languageRuntime/common/languageRuntimeService.js';
import { IPathService } from '../../../path/common/pathService.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { RuntimeDiscoveryCache } from '../../common/runtimeDiscoveryCache.js';
import {
	RUNTIME_DISCOVERY_CACHE_ENABLED_SETTING,
	RUNTIME_DISCOVERY_CACHE_MAX_AGE_MS,
	RUNTIME_DISCOVERY_CACHE_STORAGE_KEY,
} from '../../common/runtimeDiscoveryCacheService.js';

interface IFakeFile {
	resolved: string;
	size: number;
	mtime: number;
	ctime: number;
	isFile?: boolean;
	isDirectory?: boolean;
	isSymbolicLink?: boolean;
}

/**
 * Backing maps for the file service stub. Tests mutate these between cases,
 * and the IFileService stub reads through to whatever's currently in the map.
 */
class FakeFileService implements Partial<IFileService> {
	files = new Map<string, IFakeFile>();

	async realpath(resource: URI): Promise<URI | undefined> {
		const f = this.files.get(resource.fsPath);
		return f ? URI.file(f.resolved) : undefined;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async stat(resource: URI): Promise<any> {
		const f = this.files.get(resource.fsPath);
		if (!f) {
			throw new Error(`stat: not found ${resource.fsPath}`);
		}
		return {
			resource,
			name: 'mock',
			readonly: false,
			locked: false,
			executable: true,
			etag: '',
			size: f.size,
			mtime: f.mtime,
			ctime: f.ctime,
			isFile: f.isFile ?? true,
			isDirectory: f.isDirectory ?? false,
			isSymbolicLink: f.isSymbolicLink ?? false,
		};
	}
}

function metadata(overrides: {
	extensionId?: string;
	languageId?: string;
	runtimePath?: string;
	runtimeId?: string;
	cacheable?: boolean;
} = {}): ILanguageRuntimeMetadata {
	return {
		runtimePath: overrides.runtimePath ?? '/usr/bin/python3',
		runtimeId: overrides.runtimeId ?? 'rt-1',
		languageName: 'Python',
		languageId: overrides.languageId ?? 'python',
		languageVersion: '3.12.0',
		base64EncodedIconSvg: undefined,
		runtimeName: 'Python 3.12',
		runtimeShortName: '3.12',
		runtimeVersion: '0.1',
		runtimeSource: 'System',
		startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
		sessionLocation: LanguageRuntimeSessionLocation.Workspace,
		extensionId: new ExtensionIdentifier(overrides.extensionId ?? 'ms.python'),
		extraRuntimeData: {},
		cacheable: overrides.cacheable ?? true,
	};
}

const PY_PATH = '/usr/bin/python3';
const R_PATH = '/usr/local/bin/R';

describe('RuntimeDiscoveryCache', () => {

	// Per-test mutable state. The builder builds once at describe scope, but
	// the stubs themselves are swappable -- beforeEach replaces them with
	// fresh instances so each case starts with a clean cache + file system.
	// The initial values here exist only to satisfy the builder's typing;
	// they are reassigned inside the beforeEach below before any test runs.
	let storage: TestStorageService = undefined!;
	let config: TestConfigurationService = undefined!;
	let files: FakeFileService = undefined!;

	const ctx = createTestContainer()
		.stub(IStorageService, {})
		.stub(IConfigurationService, {})
		.stub(IFileService, {})
		.stub(ILogService, new NullLogService())
		.stub(IPathService, { userHome: () => URI.file('/home/test') })
		.build();

	beforeEach(() => {
		// Reset the stubs to fresh instances. The builder rewires services on
		// every test via its own beforeEach, so we override after that with our
		// per-test instances.
		storage = ctx.disposables.add(new TestStorageService()) as TestStorageService;
		config = new TestConfigurationService({});
		files = new FakeFileService();
		files.files.set(PY_PATH, { resolved: PY_PATH, size: 100, mtime: 1000, ctime: 1000 });
		files.files.set(R_PATH, { resolved: R_PATH, size: 200, mtime: 2000, ctime: 2000 });
		ctx.instantiationService.stub(IStorageService, storage);
		ctx.instantiationService.stub(IConfigurationService, config);
		ctx.instantiationService.stub(IFileService, files as unknown as IFileService);
	});

	function makeCache(): RuntimeDiscoveryCache {
		return ctx.disposables.add(ctx.instantiationService.createInstance(RuntimeDiscoveryCache)) as RuntimeDiscoveryCache;
	}

	describe('upsert / getEntries', () => {
		it('persists a cacheable entry that points at a regular file', async () => {
			const cache = makeCache();
			const entry = await cache.upsert(metadata({ runtimePath: PY_PATH }));
			expect(entry).toBeDefined();
			expect(entry?.fingerprint).toEqual({ size: 100, mtimeMs: 1000, ctimeMs: 1000 });
			expect(entry?.resolvedPath).toBe(PY_PATH);

			const fetched = cache.getEntries('ms.python', 'python');
			expect(fetched).toHaveLength(1);
			expect(fetched[0].metadata.runtimeId).toBe('rt-1');
		});

		it('survives a process restart by reloading from storage', async () => {
			const cache1 = makeCache();
			await cache1.upsert(metadata({ runtimePath: PY_PATH }));

			// Reuse the same backing storage; simulate a restart.
			const cache2 = makeCache();
			const entries = cache2.getEntries('ms.python', 'python');
			expect(entries).toHaveLength(1);
			expect(entries[0].metadata.runtimeId).toBe('rt-1');
		});

		it('preserves firstSeen but bumps lastValidated on re-upsert', async () => {
			const cache = makeCache();
			const first = await cache.upsert(metadata({ runtimePath: PY_PATH }));
			expect(first).toBeDefined();
			const firstSeen = first!.firstSeen;

			const second = await cache.upsert(metadata({ runtimePath: PY_PATH }));
			expect(second?.firstSeen).toBe(firstSeen);
			expect(second?.lastValidated).toBeGreaterThanOrEqual(firstSeen);
		});
	});

	describe('defensive write filter', () => {
		it('rejects metadata that did not opt in to caching', async () => {
			const cache = makeCache();
			const entry = await cache.upsert(metadata({ runtimePath: PY_PATH, cacheable: false }));
			expect(entry).toBeUndefined();
			expect(cache.getEntries('ms.python', 'python')).toEqual([]);
		});

		it('rejects entries whose runtimePath cannot be stat-ed', async () => {
			const cache = makeCache();
			const entry = await cache.upsert(metadata({ runtimePath: '/no/such/binary' }));
			expect(entry).toBeUndefined();
		});

		it('rejects entries whose runtimePath resolves to a directory', async () => {
			files.files.set('/some/dir', {
				resolved: '/some/dir', size: 0, mtime: 0, ctime: 0,
				isFile: false, isDirectory: true,
			});
			const cache = makeCache();
			const entry = await cache.upsert(metadata({ runtimePath: '/some/dir' }));
			expect(entry).toBeUndefined();
		});

		it('rejects entries whose runtimePath is empty', async () => {
			const cache = makeCache();
			const entry = await cache.upsert(metadata({ runtimePath: '' }));
			expect(entry).toBeUndefined();
		});

		it('expands a leading ~ via IWorkbenchEnvironmentService.userHome', async () => {
			const realPath = '/home/test/.pyenv/versions/3.12.0/bin/python';
			files.files.set(realPath, { resolved: realPath, size: 50, mtime: 5, ctime: 5 });
			const cache = makeCache();
			const entry = await cache.upsert(metadata({ runtimePath: '~/.pyenv/versions/3.12.0/bin/python' }));
			expect(entry).toBeDefined();
			expect(entry?.resolvedPath).toBe(realPath);
		});
	});

	describe('invalidate', () => {
		it('removes the entry and bumps the eviction counter', async () => {
			const cache = makeCache();
			await cache.upsert(metadata({ runtimePath: PY_PATH }));

			cache.invalidate('ms.python', 'python', PY_PATH);

			expect(cache.getEntries('ms.python', 'python')).toEqual([]);
			expect(cache.sessionCounters.evictions).toBe(1);
		});

		it('is a no-op for unknown entries (no eviction recorded)', () => {
			const cache = makeCache();
			cache.invalidate('ms.python', 'python', PY_PATH);
			expect(cache.sessionCounters.evictions).toBe(0);
		});
	});

	describe('markValidated', () => {
		it('updates lastValidated and the fingerprint', async () => {
			const cache = makeCache();
			const initial = await cache.upsert(metadata({ runtimePath: PY_PATH }));
			expect(initial).toBeDefined();
			const initialValidated = initial!.lastValidated;

			const updated = cache.markValidated('ms.python', 'python', PY_PATH, {
				size: 999, mtimeMs: 2000, ctimeMs: 2500,
			});
			expect(updated).toBe(true);

			const [entry] = cache.getEntries('ms.python', 'python');
			expect(entry.fingerprint).toEqual({ size: 999, mtimeMs: 2000, ctimeMs: 2500 });
			expect(entry.lastValidated).toBeGreaterThanOrEqual(initialValidated);
		});

		it('returns false when the entry is unknown', () => {
			const cache = makeCache();
			const updated = cache.markValidated('ms.python', 'python', PY_PATH, {
				size: 1, mtimeMs: 1, ctimeMs: 1,
			});
			expect(updated).toBe(false);
		});
	});

	describe('age cap', () => {
		it('hides entries older than the max-age cap', async () => {
			const cache = makeCache();
			const entry = await cache.upsert(metadata({ runtimePath: PY_PATH }));
			expect(entry).toBeDefined();
			expect(cache.getEntries('ms.python', 'python')).toHaveLength(1);

			vi.useFakeTimers();
			vi.setSystemTime(Date.now() + RUNTIME_DISCOVERY_CACHE_MAX_AGE_MS + 1);
			try {
				expect(cache.getEntries('ms.python', 'python')).toEqual([]);
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('schema versioning', () => {
		it('wipes the persisted blob when the schemaVersion does not match', () => {
			storage.store(
				RUNTIME_DISCOVERY_CACHE_STORAGE_KEY,
				JSON.stringify({
					schemaVersion: 999,
					buckets: { 'ms.python::python': { entries: [], lastFullDiscovery: 0 } },
				}),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE,
			);

			makeCache();

			expect(storage.get(RUNTIME_DISCOVERY_CACHE_STORAGE_KEY, StorageScope.APPLICATION)).toBeUndefined();
		});

		it('discards an unparseable persisted blob', () => {
			storage.store(
				RUNTIME_DISCOVERY_CACHE_STORAGE_KEY,
				'not-json',
				StorageScope.APPLICATION,
				StorageTarget.MACHINE,
			);

			const cache = makeCache();

			expect(cache.getAllBuckets()).toEqual([]);
			expect(storage.get(RUNTIME_DISCOVERY_CACHE_STORAGE_KEY, StorageScope.APPLICATION)).toBeUndefined();
		});
	});

	describe('full-discovery timestamp', () => {
		it('round-trips set/get', () => {
			const cache = makeCache();

			expect(cache.getLastFullDiscovery('ms.python', 'python')).toBeUndefined();

			cache.setLastFullDiscovery('ms.python', 'python', 12345);
			expect(cache.getLastFullDiscovery('ms.python', 'python')).toBe(12345);
		});
	});

	describe('clear', () => {
		it('wipes all entries and removes the persisted blob', async () => {
			const cache = makeCache();
			await cache.upsert(metadata({ runtimePath: PY_PATH }));
			await cache.upsert(metadata({
				runtimePath: R_PATH, languageId: 'r', runtimeId: 'r-rt-1', extensionId: 'posit.positron-r',
			}));
			expect(cache.getAllBuckets().length).toBeGreaterThan(0);

			cache.clear();

			expect(cache.getAllBuckets()).toEqual([]);
			expect(storage.get(RUNTIME_DISCOVERY_CACHE_STORAGE_KEY, StorageScope.APPLICATION)).toBeUndefined();
		});
	});

	describe('disabled setting', () => {
		it('returns empty entries and refuses writes', async () => {
			await config.setUserConfiguration(RUNTIME_DISCOVERY_CACHE_ENABLED_SETTING, false);
			const cache = makeCache();

			const entry = await cache.upsert(metadata({ runtimePath: PY_PATH }));
			expect(entry).toBeUndefined();
			expect(cache.getEntries('ms.python', 'python')).toEqual([]);
			expect(cache.getAllBuckets()).toEqual([]);
			expect(cache.isEnabled()).toBe(false);
		});

		it('hides previously-persisted entries while disabled', async () => {
			// First, populate the cache with the setting on.
			const cache1 = makeCache();
			await cache1.upsert(metadata({ runtimePath: PY_PATH }));
			expect(cache1.getEntries('ms.python', 'python')).toHaveLength(1);

			// Now flip the setting and rebuild on the same storage.
			await config.setUserConfiguration(RUNTIME_DISCOVERY_CACHE_ENABLED_SETTING, false);
			const cache2 = makeCache();
			expect(cache2.getEntries('ms.python', 'python')).toEqual([]);
		});
	});
});
