/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IPositronConnectionInstance, IPositronConnectionItem } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';
import { IPositronConnectionEntry } from 'vs/workbench/services/positronConnections/browser/positronConnectionsCache';
import { Event } from 'vs/base/common/event';

export const IPositronConnectionsService = createDecorator<IPositronConnectionsService>('positronConnectionsService');
export const POSITRON_CONNECTIONS_VIEW_ID = 'workbench.panel.positronConnections';

export interface IPositronConnectionsService {
	readonly _serviceBrand: undefined;
	initialize(): void;
	addConnection(instance: IPositronConnectionInstance): void;
	getConnections(): IPositronConnectionItem[];
	closeConnection(id: string): void;
	clearAllConnections(): void;

	/**
	 * Returns a flattended list of entries that the service is currently displaying.
	 */
	getConnectionEntries(): IPositronConnectionEntry[];

	/**
	 * Refresh the connections entries cache and fires the onDidChangeEntries event when it's done.
	 */
	refreshConnectionEntries(): Promise<void>;

	/**
	 * An event that users can subscribe to receive updates when the flattened list
	 * of entries changes.
	 */
	onDidChangeEntries: Event<IPositronConnectionEntry[]>;
}
