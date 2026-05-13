/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IDataConnectionDriver } from './dataConnectionDriver.js';

/**
 * Manages registered data connection drivers.
 */
export interface IDataConnectionsDriverManager {
	/**
	 * Registers a driver.
	 * @param driver The driver to register.
	 */
	registerDriver(driver: IDataConnectionDriver): void;

	/**
	 * Removes a driver.
	 * @param driverId The ID of the driver to remove.
	 */
	removeDriver(driverId: string): void;

	// A value which indicates whether the drivers are loaded.
	readonly driversLoaded: boolean;

	/**
	 * Gets all drivers.
	 * @return An array of all registered drivers.
	 */
	getDrivers(): IDataConnectionDriver[];

	/**
	 * Gets a driver.
	 * @param driverId The driver ID of the driver to get.
	 */
	getDriver(driverId: string): IDataConnectionDriver | undefined;

	/**
	 * Fires whenever a driver is registered or removed.
	 */
	onDidChangeDrivers: Event<IDataConnectionDriver[]>;
}
