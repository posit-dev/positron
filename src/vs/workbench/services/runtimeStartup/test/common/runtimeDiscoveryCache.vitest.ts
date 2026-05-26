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
	IRuntimeRootSignature,
	RUNTIME_DISCOVERY_CACHE_ENABLED_SETTING,
	RUNTIME_DISCOVERY_CACHE_MAX_AGE_DAYS_DEFAULT,
	RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION,
	RUNTIME_DISCOVERY_CACHE_STORAGE_KEY,
	signaturesEqual,
} from '../../common/runtimeDiscoveryCacheService.js';

const MAX_AGE_MS = RUNTIME_DISCOVERY_CACHE_MAX_AGE_DAYS_DEFAULT * 24 * 60 * 60 * 1000;

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
			vi.setSystemTime(Date.now() + MAX_AGE_MS + 1);
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

	describe('discovery root signature', () => {
		const sig = (entries: Array<[string, boolean, number]>, opaque?: string): IRuntimeRootSignature => ({
			entries: entries.map(([path, exists, mtimeMs]) => ({ path, exists, mtimeMs })),
			opaque,
		});

		it('returns undefined before anything is set', () => {
			const cache = makeCache();
			expect(cache.getDiscoveryRootSignature('ms.python', 'python')).toBeUndefined();
		});

		it('round-trips set/get for an empty (no entries) bucket', () => {
			const cache = makeCache();
			const s = sig([['/usr/bin', true, 1000]]);

			cache.setDiscoveryRootSignature('ms.python', 'python', s);

			const read = cache.getDiscoveryRootSignature('ms.python', 'python');
			expect(read).toEqual(s);
		});

		it('survives a process restart by reloading from storage', () => {
			const cache1 = makeCache();
			const s = sig([
				['/usr/local/bin', true, 5000],
				['/opt/homebrew/bin', false, 0],
			], 'v1');
			cache1.setDiscoveryRootSignature('ms.python', 'python', s);

			const cache2 = makeCache();
			expect(cache2.getDiscoveryRootSignature('ms.python', 'python')).toEqual(s);
		});

		it('coexists with cached entries on the same bucket', async () => {
			const cache = makeCache();
			await cache.upsert(metadata({ runtimePath: PY_PATH }));

			const s = sig([['/usr/bin', true, 1000]]);
			cache.setDiscoveryRootSignature('ms.python', 'python', s);

			expect(cache.getEntries('ms.python', 'python')).toHaveLength(1);
			expect(cache.getDiscoveryRootSignature('ms.python', 'python')).toEqual(s);
		});

		it('does not write when the cache is disabled', async () => {
			await config.setUserConfiguration(RUNTIME_DISCOVERY_CACHE_ENABLED_SETTING, false);
			const cache = makeCache();

			cache.setDiscoveryRootSignature('ms.python', 'python', sig([['/usr/bin', true, 1000]]));

			// Disabled -> getAllBuckets returns empty, but the in-memory state
			// also shouldn't have absorbed the write.
			expect(cache.getDiscoveryRootSignature('ms.python', 'python')).toBeUndefined();
		});
	});

	describe('signaturesEqual', () => {
		it('returns false when either side is undefined', () => {
			const s = { entries: [{ path: '/a', exists: true, mtimeMs: 1 }] };
			expect(signaturesEqual(undefined, s)).toBe(false);
			expect(signaturesEqual(s, undefined)).toBe(false);
			expect(signaturesEqual(undefined, undefined)).toBe(false);
		});

		it('treats empty signatures as equal to themselves', () => {
			const a = { entries: [] };
			const b = { entries: [] };
			expect(signaturesEqual(a, b)).toBe(true);
		});

		it('detects differing length', () => {
			const a = { entries: [{ path: '/a', exists: true, mtimeMs: 1 }] };
			const b = { entries: [] };
			expect(signaturesEqual(a, b)).toBe(false);
		});

		it('detects mtime delta on a single entry', () => {
			const a = { entries: [{ path: '/a', exists: true, mtimeMs: 1 }] };
			const b = { entries: [{ path: '/a', exists: true, mtimeMs: 2 }] };
			expect(signaturesEqual(a, b)).toBe(false);
		});

		it('detects exists flip on a single entry', () => {
			const a = { entries: [{ path: '/a', exists: false, mtimeMs: 0 }] };
			const b = { entries: [{ path: '/a', exists: true, mtimeMs: 1 }] };
			expect(signaturesEqual(a, b)).toBe(false);
		});

		it('detects path reorder', () => {
			const a = {
				entries: [
					{ path: '/a', exists: true, mtimeMs: 1 },
					{ path: '/b', exists: true, mtimeMs: 2 },
				]
			};
			const b = {
				entries: [
					{ path: '/b', exists: true, mtimeMs: 2 },
					{ path: '/a', exists: true, mtimeMs: 1 },
				]
			};
			// Order is part of the signature; reordering is a delta.
			expect(signaturesEqual(a, b)).toBe(false);
		});

		it('detects opaque blob delta', () => {
			const a = { entries: [], opaque: 'v1' };
			const b = { entries: [], opaque: 'v2' };
			expect(signaturesEqual(a, b)).toBe(false);
		});

		it('returns true when entries and opaque are deep-equal', () => {
			const a = {
				entries: [
					{ path: '/a', exists: true, mtimeMs: 1 },
					{ path: '/b', exists: false, mtimeMs: 0 },
				], opaque: 'v1'
			};
			const b = {
				entries: [
					{ path: '/a', exists: true, mtimeMs: 1 },
					{ path: '/b', exists: false, mtimeMs: 0 },
				], opaque: 'v1'
			};
			expect(signaturesEqual(a, b)).toBe(true);
		});
	});

	describe('rootsChanged session counter', () => {
		it('increments only on root-triggered full discoveries', () => {
			const cache = makeCache();
			cache.recordFullDiscoveryRun('ms.python', 'python', 'cold-start');
			cache.recordFullDiscoveryRun('ms.python', 'python', 'periodic');
			expect(cache.sessionCounters.rootsChangedFullDiscoveries).toBe(0);

			cache.recordFullDiscoveryRun('ms.python', 'python', 'roots-changed');
			cache.recordFullDiscoveryRun('ms.python', 'python', 'roots-changed');
			expect(cache.sessionCounters.rootsChangedFullDiscoveries).toBe(2);
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

	describe('cross-window updates', () => {
		// APPLICATION-scope storage is shared across all Positron windows on
		// the machine. Without the storage-change listener, two windows would
		// last-writer-wins each other's persisted state. These tests verify
		// the listener picks up sibling writes (`external: true`).
		const PY_ENTRY = {
			fingerprint: { size: 100, mtimeMs: 1000, ctimeMs: 1000 },
			resolvedPath: PY_PATH,
		};

		function siblingWrite(entries: Array<{ runtimePath: string; runtimeId: string } & typeof PY_ENTRY>, lastFullDiscovery = 0): void {
			const now = Date.now();
			storage.store(
				RUNTIME_DISCOVERY_CACHE_STORAGE_KEY,
				JSON.stringify({
					schemaVersion: RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION,
					buckets: {
						'ms.python::python': {
							entries: entries.map(e => ({
								metadata: metadata({ runtimePath: e.runtimePath, runtimeId: e.runtimeId }),
								fingerprint: e.fingerprint,
								resolvedPath: e.resolvedPath,
								firstSeen: now,
								lastValidated: now,
							})),
							lastFullDiscovery,
						},
					},
				}),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE,
				/* external */ true,
			);
		}

		it('reloads when a sibling window writes the cache', () => {
			const cache = makeCache();
			expect(cache.getEntries('ms.python', 'python')).toEqual([]);

			siblingWrite([{ runtimePath: PY_PATH, runtimeId: 'rt-1', ...PY_ENTRY }], 12345);

			const entries = cache.getEntries('ms.python', 'python');
			expect(entries).toHaveLength(1);
			expect(entries[0].metadata.runtimeId).toBe('rt-1');
			expect(cache.getLastFullDiscovery('ms.python', 'python')).toBe(12345);
		});

		it('drops local-only entries that the sibling write does not contain', async () => {
			const cache = makeCache();
			await cache.upsert(metadata({ runtimePath: PY_PATH, runtimeId: 'local-1' }));
			expect(cache.getEntries('ms.python', 'python')).toHaveLength(1);

			// Sibling persisted a different runtime at a different path.
			const altPath = '/opt/python/bin/python3';
			files.files.set(altPath, { resolved: altPath, size: 50, mtime: 5, ctime: 5 });
			siblingWrite([{
				runtimePath: altPath,
				runtimeId: 'sibling-1',
				fingerprint: { size: 50, mtimeMs: 5, ctimeMs: 5 },
				resolvedPath: altPath,
			}]);

			const entries = cache.getEntries('ms.python', 'python');
			expect(entries).toHaveLength(1);
			expect(entries[0].metadata.runtimeId).toBe('sibling-1');
		});

		it('empties in-memory state when a sibling window clears storage', async () => {
			const cache = makeCache();
			await cache.upsert(metadata({ runtimePath: PY_PATH }));
			expect(cache.getEntries('ms.python', 'python')).toHaveLength(1);

			storage.remove(RUNTIME_DISCOVERY_CACHE_STORAGE_KEY, StorageScope.APPLICATION, /* external */ true);

			expect(cache.getEntries('ms.python', 'python')).toEqual([]);
			expect(cache.getAllBuckets()).toEqual([]);
		});

		it('ignores in-process change events from its own writes', async () => {
			// If the listener didn't filter out non-external events, our own
			// _persist would re-trigger _reloadFromStorage during upsert and we
			// could miss the just-set firstSeen. Verify firstSeen is preserved
			// across a re-upsert (which goes through two _persist calls).
			const cache = makeCache();
			const first = await cache.upsert(metadata({ runtimePath: PY_PATH }));
			const second = await cache.upsert(metadata({ runtimePath: PY_PATH }));
			expect(second?.firstSeen).toBe(first?.firstSeen);
		});
	});
});
