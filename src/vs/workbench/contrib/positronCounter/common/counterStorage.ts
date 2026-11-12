/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { StateStorage } from 'zustand/middleware';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

/**
 * Adapts Positron's storage service to zustand's `StateStorage`, so the persist
 * middleware writes to profile storage instead of `localStorage`. It is
 * synchronous, so a store hydrates before `createStore` returns.
 */
export function createStorageStateStorage(storageService: IStorageService): StateStorage {
	return {
		getItem: name => storageService.get(name, StorageScope.PROFILE) ?? null,
		setItem: (name, value) => storageService.store(name, value, StorageScope.PROFILE, StorageTarget.MACHINE),
		removeItem: name => storageService.remove(name, StorageScope.PROFILE),
	};
}
