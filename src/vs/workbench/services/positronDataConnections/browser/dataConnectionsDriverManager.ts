/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { IDataConnectionDriver } from '../common/interfaces/dataConnectionDriver.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IDataConnectionsDriverManager } from '../common/interfaces/dataConnectionsDriverManager.js';

/**
 * DataConnectionsDriverManager class.
 */
export class DataConnectionsDriverManager extends Disposable implements IDataConnectionsDriverManager {
	// A value which indicates whether the drivers are loaded.
	private _driversLoaded = false;

	// The registered data connection drivers.
	private readonly _drivers: IDataConnectionDriver[] = [];

	// The onDidChangeDrivers event emitter.
	private readonly _onDidChangeDrivers = this._register(new Emitter<IDataConnectionDriver[]>());

	// The onDidChangeDrivers event.
	readonly onDidChangeDrivers: Event<IDataConnectionDriver[]> = this._onDidChangeDrivers.event;

	/**
	 * Constructor. Subscribes to onStartupFinished activation so callers can tell "still loading"
	 * from "extension is genuinely absent" when looking up a driver.
	 */
	constructor(extensionService: IExtensionService) {
		// Call the base class constructor.
		super();

		// Subscribe to the onStartupFinished activation event. Once it resolves, any extensions
		// registered against it have had a chance to register their drivers, so a missing driver
		// can be reported as "genuinely absent" rather than "still loading." If activation fails,
		// flip the flag anyway so the UI doesn't hang in "still loading" forever.
		extensionService.activateByEvent('onStartupFinished').then(
			() => { this._driversLoaded = true; },
			err => {
				this._driversLoaded = true;
				onUnexpectedError(err);
			}
		);
	}

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
	 * Gets a value indicating whether the drivers have finished loading. Callers can use this to determine
	 * whether an absent driver is still loading or genuinely not present.
	 * @returns true if the drivers have finished loading; otherwise, false.
	 */
	get driversLoaded(): boolean {
		return this._driversLoaded;
	}

	/**
	 * Gets all drivers.
	 * @returns The array of drivers.
	 */
	getDrivers(): IDataConnectionDriver[] {
		return [...this._drivers];
	}

	/**
	 * Gets a driver.
	 * @param driverId The driver ID of the driver to get.
	 * @return The driver with the given ID, or undefined if not found.
	 */
	getDriver(driverId: string): IDataConnectionDriver | undefined {
		return this._drivers.find(d => d.id === driverId);
	}
}
