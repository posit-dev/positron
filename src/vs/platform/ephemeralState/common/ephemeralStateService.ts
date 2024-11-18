/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEphemeralStateService } from 'vs/platform/ephemeralState/common/ephemeralState';

export class EphemeralStateService implements IEphemeralStateService {

	_serviceBrand: undefined;

	private readonly data = new Map<string, object | string | number | boolean | undefined | null>();

	async setItem(key: string, data?: object | string | number | boolean | undefined | null): Promise<void> {
		this.data.set(key, data);
	}

	async getItem<T>(key: string): Promise<T | undefined> {
		return this.data.get(key) as T | undefined;
	}

	async removeItem(key: string): Promise<void> {
		this.data.delete(key);
	}
}
