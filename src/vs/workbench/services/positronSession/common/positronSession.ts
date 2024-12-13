/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IPositronSessionMetadata {
	readonly ordinal: number;
	readonly created: number;
}

export const POSITRON_SESSION_SERVICE_ID = 'positronSessionService';

export const IPositronSessionService = createDecorator<IPositronSessionService>(POSITRON_SESSION_SERVICE_ID);

/**
 * IPositronSessionService interface.
 */
export interface IPositronSessionService {
	readonly _serviceBrand: undefined;

	getSessionOrdinal(): Promise<number>;

	getSessionMetadata(): Promise<IPositronSessionMetadata>;
}
