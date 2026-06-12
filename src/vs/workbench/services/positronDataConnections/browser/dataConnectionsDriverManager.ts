/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IDataConnectionDriver } from '../common/interfaces/dataConnectionDriver.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IDataConnectionsDriverManager } from '../common/interfaces/dataConnectionsDriverManager.js';

/**
 * Activation event fired when the Data Connections view is shown. Driver-providing extensions
 * declare this event so they only activate when the user actually opens the view, rather than
 * eagerly on startup. Must match the view id registered in positronDataConnections.contribution.ts.
 */
const DATA_CONNECTIONS_VIEW_ACTIVATION_EVENT = 'onView:workbench.panel.positronDataConnections';

/**
 * DataConnectionsDriverManager class.
 */
export class DataConnectionsDriverManager extends Disposable implements IDataConnectionsDriverManager {
	// The registered data connection drivers.
	private readonly _drivers: IDataConnectionDriver[] = [];

	// The onDidChangeDrivers event emitter.
	private readonly _onDidChangeDrivers = this._register(new Emitter<IDataConnectionDriver[]>());

	// The onDidChangeDrivers event.
	readonly onDidChangeDrivers: Event<IDataConnectionDriver[]> = this._onDidChangeDrivers.event;

	/**
	 * Constructor. This manager is constructed eagerly at startup (via mainThreadDataConnections and
	 * PositronReactServices), so it deliberately does not trigger driver activation here: doing so
	 * would force the driver extensions to load on every session even though the Data Connections
	 * feature is off by default and most sessions never use it. Driver extensions instead activate
	 * lazily on the view activation event (see driversLoaded).
	 */
	constructor(private readonly _extensionService: IExtensionService) {
		// Call the base class constructor.
		super();
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
	 *
	 * This passively observes whether the view activation event has resolved (i.e. the driver
	 * extensions registered against it have had a chance to register their drivers) without
	 * triggering activation itself. The Data Connections view triggers the activation when it is
	 * shown, so by the time a user can look up a driver from the view the event has resolved.
	 * @returns true if the drivers have finished loading; otherwise, false.
	 */
	get driversLoaded(): boolean {
		return this._extensionService.activationEventIsDone(DATA_CONNECTIONS_VIEW_ACTIVATION_EVENT);
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
