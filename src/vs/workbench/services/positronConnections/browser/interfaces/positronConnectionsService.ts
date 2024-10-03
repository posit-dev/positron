/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IPositronConnectionsService = createDecorator<IPositronConnectionsService>('positronConnectionsService');

export interface IPositronConnectionsService {
	readonly _serviceBrand: undefined;
	initialize(): void;
}
