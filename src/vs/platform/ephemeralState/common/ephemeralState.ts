/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IEphemeralStateService = createDecorator<IEphemeralStateService>('ephemeralStateService');

/**
 * A simple service that stores data in memory.
 *
 * This service is used to store data at the session level, such that it
 * survives a browser refresh but doesn't persist across user sessions.
 */
export interface IEphemeralStateService {

	readonly _serviceBrand: undefined;

	getItem<T>(key: string, defaultValue: T): Promise<T>;
	getItem<T>(key: string, defaultValue?: T): Promise<T | undefined>;
	setItem(key: string, data?: object | string | number | boolean | undefined | null): Promise<void>;

	removeItem(key: string): Promise<void>;
}
