/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IDataConnectionDriver, IDataConnectionDriverManager } from '../common/interfaces/positronDataConnectionsDriver.js';

/**
 * DataConnectionDriverManager class.
 */
export class DataConnectionDriverManager extends Disposable implements IDataConnectionDriverManager {
	// The registered data connection drivers.
	private readonly _drivers: IDataConnectionDriver[] = [];

	// The onDidChangeDrivers event emitter.
	private readonly _onDidChangeDrivers = this._register(new Emitter<IDataConnectionDriver[]>());

	// The onDidChangeDrivers event.
	readonly onDidChangeDrivers: Event<IDataConnectionDriver[]> = this._onDidChangeDrivers.event;

	/**
	 * Registers a driver.
	 * @param driver The driver to register.
	 */
	registerDriver(driver: IDataConnectionDriver): void {
		// See if we already have the driver registered.
		const index = this._drivers.findIndex(d => d.id === driver.id);

		// If we already have the driver registered, replace it; otherwise, add it.
		if (index >= 0) {
			this._drivers[index] = driver;
		} else {
			this._drivers.push(driver);
		}

		// Raise the onDidChangeDrivers event.
		this._onDidChangeDrivers.fire([...this._drivers]);
	}

	/**
	 * Removes a driver.
	 * @param driverId The ID of the driver to remove.
	 */
	removeDriver(driverId: string): void {
		// Find the index of the driver.
		const index = this._drivers.findIndex(d => d.id === driverId);
		if (index >= 0) {
			// Remove the driver.
			this._drivers.splice(index, 1);

			// Raise the onDidChangeDrivers event.
			this._onDidChangeDrivers.fire([...this._drivers]);
		}
	}

	/**
	 * Gets all drivers.
	 */
	getDrivers(): IDataConnectionDriver[] {
		return [...this._drivers];
	}

	/**
	 * Gets a driver.
	 * @param driverId The driver ID of the driver to get.
	 */
	getDriver(driverId: string): IDataConnectionDriver | undefined {
		return this._drivers.find(d => d.id === driverId);
	}
}
