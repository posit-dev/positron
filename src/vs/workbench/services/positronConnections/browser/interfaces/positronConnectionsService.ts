/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IPositronConnectionItem } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';

export const IPositronConnectionsService = createDecorator<IPositronConnectionsService>('positronConnectionsService');
export const POSITRON_CONNECTIONS_VIEW_ID = 'workbench.panel.positronConnections';

export interface IPositronConnectionsService {
	readonly _serviceBrand: undefined;
	initialize(): void;
	getConnections(): IPositronConnectionItem[];
}
