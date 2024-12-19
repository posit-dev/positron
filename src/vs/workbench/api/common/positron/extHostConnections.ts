/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as extHostProtocol from './extHost.positron.protocol.js';
import { Input } from '../../../services/positronConnections/common/interfaces/positronConnectionsDriver.js';
import { Disposable } from '../extHostTypes.js';

export class ExtHostConnections implements extHostProtocol.ExtHostConnectionsShape {

	private readonly _proxy: extHostProtocol.MainThreadConnectionsShape;
	private _drivers: positron.ConnectionsDriver[] = [];

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
	) {
		// Trigger creation of the proxy
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadConnections);
	}

	public registerConnectionDriver(driver: positron.ConnectionsDriver): Disposable {
		// Check if the driver is already registered, and if not push, otherwise replace
		const existingDriverIndex = this._drivers.findIndex(d => d.driverId === driver.driverId);
		if (existingDriverIndex !== -1) {
			this._drivers[existingDriverIndex] = driver;
		} else {
			this._drivers.push(driver);
		}

		this._proxy.$registerConnectionDriver(
			driver.driverId,
			driver.metadata,
			{
				generateCode: driver.generateCode ? true : false,
				connect: driver.connect ? true : false,
				checkDependencies: driver.checkDependencies ? true : false,
				installDependencies: driver.installDependencies ? true : false
			}
		);

		// When the driver is disposed, remove it from the list and notify the main thread
		return new Disposable(() => {
			this._drivers = this._drivers.filter(d => d.driverId !== driver.driverId);
			this._proxy.$removeConnectionDriver(driver.driverId);
		});
	}

	public async $driverGenerateCode(driverId: string, inputs: Input[]) {
		const driver = this._drivers.find(d => d.driverId === driverId);
		if (!driver || !driver.generateCode) {
			throw new Error(`Driver ${driverId} does not support code generation`);
		}
		return driver.generateCode(inputs);
	}

	public async $driverConnect(driverId: string, code: string): Promise<void> {
		const driver = this._drivers.find(d => d.driverId === driverId);
		if (!driver || !driver.connect) {
			throw new Error(`Driver ${driverId} does not support connecting`);
		}
		return driver.connect(code);
	}

	public async $driverCheckDependencies(driverId: string): Promise<boolean> {
		const driver = this._drivers.find(d => d.driverId === driverId);
		if (!driver || !driver.checkDependencies) {
			throw new Error(`Driver ${driverId} does not support checking dependencies`);
		}
		return driver.checkDependencies();
	}

	public async $driverInstallDependencies(driverId: string): Promise<boolean> {
		const driver = this._drivers.find(d => d.driverId === driverId);
		if (!driver || !driver.installDependencies) {
			throw new Error(`Driver ${driverId} does not support installing dependencies`);
		}
		return driver.installDependencies();
	}
}
