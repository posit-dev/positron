/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IPositronConnectionInstance } from './positronConnectionsInstance.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import Severity from '../../../../../base/common/severity.js';
import { INotificationHandle } from '../../../../../platform/notification/common/notification.js';
import { IRuntimeSessionService } from '../../../runtimeSession/common/runtimeSessionService.js';
import { PositronConnectionsDriverManager } from '../../browser/positronConnectionsDrivers.js';

export const IPositronConnectionsService = createDecorator<IPositronConnectionsService>('positronConnectionsService');
export const POSITRON_CONNECTIONS_VIEW_ID = 'workbench.panel.positronConnections';

export interface IPositronConnectionsService {
	readonly _serviceBrand: undefined;
	readonly driverManager: PositronConnectionsDriverManager;

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
