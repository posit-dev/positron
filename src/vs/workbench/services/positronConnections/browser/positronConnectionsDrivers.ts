/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDriver } from '../common/interfaces/positronConnectionsDriver.js';
import { IPositronConnectionsService } from '../common/interfaces/positronConnectionsService.js';

export class PositronConnectionsDriverManager {
	private readonly drivers: IDriver[] = [];

	constructor(readonly service: IPositronConnectionsService) { }

	registerDriver(driver: IDriver): void {
		// Check that a driver with the same id does not already exist.
		const index = this.drivers.findIndex(d => d.driverId === driver.driverId);
		if (index > 0) {
			this.drivers[index] = driver;
		} else {
			this.drivers.push(driver);
		}
	}

	removeDriver(driverId: string): void {
		const index = this.drivers.findIndex(d => d.driverId === driverId);
		if (index > 0) {
			this.drivers.splice(index, 1);
		}
	}

	getDrivers(): IDriver[] {
		return this.drivers;
	}
}
