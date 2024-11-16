/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IEphemeralStateService = createDecorator<IEphemeralStateService>('ephemeralStateService');
export interface IEphemeralStateService {

	readonly _serviceBrand: undefined;

	getItem<T>(key: string, defaultValue: T): T;
	getItem<T>(key: string, defaultValue?: T): T | undefined;
	setItem(key: string, data?: object | string | number | boolean | undefined | null): void;

	removeItem(key: string): void;
}
