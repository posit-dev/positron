/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IDataConnectionDriver, IDataConnectionDriverManager } from '../common/interfaces/positronDataConnectionsDriver.js';

export class DataConnectionDriverManager extends Disposable implements IDataConnectionDriverManager {
	/**
	 * The registered data connection drivers.
	 */
	private readonly _drivers: IDataConnectionDriver[] = [];


	private readonly _onDidChangeDrivers = this._register(new Emitter<IDataConnectionDriver[]>());

	readonly onDidChangeDrivers: Event<IDataConnectionDriver[]> = this._onDidChangeDrivers.event;

	registerDriver(driver: IDataConnectionDriver): void {
		const index = this._drivers.findIndex(d => d.id === driver.id);
		if (index >= 0) {
			this._drivers[index] = driver;
		} else {
			this._drivers.push(driver);
		}
		this._onDidChangeDrivers.fire([...this._drivers]);
	}

	removeDriver(driverId: string): void {
		const index = this._drivers.findIndex(d => d.id === driverId);
		if (index >= 0) {
			this._drivers.splice(index, 1);
			this._onDidChangeDrivers.fire([...this._drivers]);
		}
	}

	getDrivers(): IDataConnectionDriver[] {
		return [...this._drivers];
	}

	getDriver(driverId: string): IDataConnectionDriver | undefined {
		return this._drivers.find(d => d.id === driverId);
	}
}
