/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import {
	ICachedPackageMetadata,
	PackageMetadataCache,
	PACKAGE_METADATA_CACHE_ENABLED_SETTING,
	PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_SETTING,
	PACKAGE_METADATA_CACHE_SCHEMA_VERSION,
	PACKAGE_METADATA_CACHE_STORAGE_KEY,
} from '../../browser/packageMetadataCache.js';

const HOUR = 60 * 60 * 1000;

describe('PackageMetadataCache', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	beforeEach(() => {
		// Isolate tests that share the container's storage.
		ctx.get(IStorageService).remove(PACKAGE_METADATA_CACHE_STORAGE_KEY, StorageScope.WORKSPACE);
	});

	function makeCache(config: Record<string, unknown> = {}): PackageMetadataCache {
		return new PackageMetadataCache(ctx.get(IStorageService), new NullLogService(), new TestConfigurationService(config));
	}

	const dplyr: ICachedPackageMetadata = { version: '1.0.0', outdated: true, latestVersion: '1.2.0' };
	const rlang: ICachedPackageMetadata = { version: '1.1.0', outdated: false };

	it('returns undefined for an unknown interpreter', () => {
		expect(makeCache().get('py-abc')).toBeUndefined();
	});

	it('round-trips an upsert, stamping lastFetched', () => {
		const cache = makeCache();
		cache.upsert('py-abc', { dplyr, rlang }, 1_000);

		expect(cache.get('py-abc')).toEqual({
			lastFetched: 1_000,
			packages: { dplyr, rlang },
		});
	});

	it('keeps interpreters isolated and persists across cache instances', () => {
		makeCache().upsert('py-abc', { dplyr }, 1_000);
		makeCache().upsert('r-xyz', { rlang }, 2_000);

		// A fresh instance reads the same backing storage.
		const reader = makeCache();
		expect(reader.get('py-abc')?.packages).toEqual({ dplyr });
		expect(reader.get('r-xyz')?.packages).toEqual({ rlang });
	});

	it('treats an entry as fresh until maxAgeHours elapses (default 24h)', () => {
		const cache = makeCache();
		cache.upsert('py-abc', { dplyr }, 0);

		expect(cache.isFresh('py-abc', 23 * HOUR)).toBe(true);
		expect(cache.isFresh('py-abc', 25 * HOUR)).toBe(false);
		expect(cache.isFresh('unknown', 0)).toBe(false);
	});

	it('honors a custom maxAgeHours setting', () => {
		const cache = makeCache({ [PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_SETTING]: 1 });
		cache.upsert('py-abc', { dplyr }, 0);

		expect(cache.isFresh('py-abc', 0.5 * HOUR)).toBe(true);
		expect(cache.isFresh('py-abc', 1.5 * HOUR)).toBe(false);
	});

	it('evicts named packages while preserving the rest and lastFetched', () => {
		const cache = makeCache();
		cache.upsert('py-abc', { dplyr, rlang }, 1_000);

		cache.evict('py-abc', ['DPLYR']); // case-insensitive

		expect(cache.get('py-abc')).toEqual({ lastFetched: 1_000, packages: { rlang } });
	});

	it('clears an entire entry', () => {
		const cache = makeCache();
		cache.upsert('py-abc', { dplyr }, 1_000);

		cache.clear('py-abc');

		expect(cache.get('py-abc')).toBeUndefined();
	});

	it('short-circuits all reads and writes when disabled', () => {
		// Seed via an enabled cache, then read/write through a disabled one.
		makeCache().upsert('py-abc', { dplyr }, 1_000);
		const disabled = makeCache({ [PACKAGE_METADATA_CACHE_ENABLED_SETTING]: false });

		disabled.upsert('r-xyz', { rlang }, 2_000);
		disabled.evict('py-abc', ['dplyr']);

		expect(disabled.get('py-abc')).toBeUndefined();
		expect(disabled.isFresh('py-abc', 1_000)).toBe(false);
		// The disabled cache wrote nothing, and the seeded entry is untouched.
		expect(makeCache().get('py-abc')?.packages).toEqual({ dplyr });
		expect(makeCache().get('r-xyz')).toBeUndefined();
	});

	it('discards a persisted blob with a mismatched schema version', () => {
		const stale = JSON.stringify({
			schemaVersion: PACKAGE_METADATA_CACHE_SCHEMA_VERSION + 1,
			environments: { 'py-abc': { lastFetched: 1_000, packages: { dplyr } } },
		});
		ctx.get(IStorageService).store(PACKAGE_METADATA_CACHE_STORAGE_KEY, stale, StorageScope.WORKSPACE, StorageTarget.MACHINE);

		expect(makeCache().get('py-abc')).toBeUndefined();
	});

	it('discards an unparseable persisted blob without throwing', () => {
		ctx.get(IStorageService).store(PACKAGE_METADATA_CACHE_STORAGE_KEY, 'not json', StorageScope.WORKSPACE, StorageTarget.MACHINE);

		expect(makeCache().get('py-abc')).toBeUndefined();
	});
});
