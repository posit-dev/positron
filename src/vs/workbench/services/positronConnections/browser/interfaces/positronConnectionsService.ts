/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IPositronConnectionInstance } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';
import { Emitter, Event } from 'vs/base/common/event';
import Severity from 'vs/base/common/severity';
import { INotificationHandle } from 'vs/platform/notification/common/notification';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

export const IPositronConnectionsService = createDecorator<IPositronConnectionsService>('positronConnectionsService');
export const POSITRON_CONNECTIONS_VIEW_ID = 'workbench.panel.positronConnections';

export interface IPositronConnectionsService {
	readonly _serviceBrand: undefined;
	initialize(): void;
	addConnection(instance: IPositronConnectionInstance): void;
	getConnections(): IPositronConnectionInstance[];
	closeConnection(id: string): void;
	removeConnection(id: string): void;
	clearAllConnections(): void;

	onDidChangeConnections: Event<IPositronConnectionInstance[]>;
	notify(message: string, severity: Severity): INotificationHandle;
	log(message: string): void;

	// Exported API that you should really think if you want to use
	// before you use it.

	/**
	 * Emits the id of the connection that has been focused
	 */
	onDidFocusEmitter: Emitter<string>;
	onDidFocus: Event<string>;

	runtimeSessionService: IRuntimeSessionService;
}
