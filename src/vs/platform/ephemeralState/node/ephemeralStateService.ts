/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEphemeralStateService } from 'vs/platform/ephemeralState/common/ephemeralState';

export class EphemeralStateService implements IEphemeralStateService {

	_serviceBrand: undefined;

	private readonly data = new Map<string, object | string | number | boolean | undefined | null>();

	setItem(key: string, data?: object | string | number | boolean | undefined | null): void {
		this.data.set(key, data);
	}

	getItem<T>(key: string): T | undefined {
		return this.data.get(key) as T | undefined;
	}

	removeItem(key: string): void {
		this.data.delete(key);
	}
}
