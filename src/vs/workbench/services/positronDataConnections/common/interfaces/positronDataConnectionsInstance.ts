/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IDataConnectionHandle } from './positronDataConnectionsDriver.js';

/**
 * A data connection instance tracked by the service and displayed in the UI.
 */
export interface IDataConnectionInstance {
	readonly id: string;
	readonly driverId: string;
	readonly driverName: string;
	readonly iconSvg: string;
	readonly connectionHandle: IDataConnectionHandle;
	active: boolean;
	onDidChangeStatus: Event<boolean>;
}
