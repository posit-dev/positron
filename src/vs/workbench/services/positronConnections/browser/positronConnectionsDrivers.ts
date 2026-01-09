/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IDriver } from '../common/interfaces/positronConnectionsDriver.js';
import { IPositronConnectionsService } from '../common/interfaces/positronConnectionsService.js';

export class PositronConnectionsDriverManager extends Disposable {
	private readonly drivers: IDriver[] = [];

	private readonly _onDidChangeDrivers = this._register(new Emitter<IDriver[]>());
	readonly onDidChangeDrivers: Event<IDriver[]> = this._onDidChangeDrivers.event;

	constructor(readonly service: IPositronConnectionsService) {
		super();
	}

	registerDriver(driver: IDriver): void {
		// Check that a driver with the same id does not already exist.
		const index = this.drivers.findIndex(d => d.driverId === driver.driverId);
		if (index > 0) {
			this.drivers[index] = driver;
		} else {
			this.drivers.push(driver);
		}
		this._onDidChangeDrivers.fire(this.drivers);
	}

	removeDriver(driverId: string): void {
		const index = this.drivers.findIndex(d => d.driverId === driverId);
		if (index > 0) {
			this.drivers.splice(index, 1);
			this._onDidChangeDrivers.fire(this.drivers);
		}
	}

	getDrivers(): IDriver[] {
		return this.drivers;
	}
}
