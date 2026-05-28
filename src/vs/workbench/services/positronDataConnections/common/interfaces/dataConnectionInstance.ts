/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IDataConnectionHandle } from './dataConnectionDriver.js';

/**
 * A data connection instance tracked by the service and displayed in the UI.
 */
export interface IDataConnectionInstance {
	readonly id: string;
	// Id of the IDataConnectionProfile this instance was created from. Every live instance is
	// derived from a saved profile, so this is always set.
	readonly profileId: string;
	readonly driverId: string;
	readonly driverName: string;
	readonly iconSvg: string;
	readonly connectionHandle: IDataConnectionHandle;
	active: boolean;
	onDidChangeStatus: Event<boolean>;
}
