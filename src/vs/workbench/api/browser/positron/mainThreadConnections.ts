/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtHostConnectionsShape, ExtHostPositronContext, MainPositronContext, MainThreadConnectionsShape } from '../../common/positron/extHost.positron.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IDriver, IDriverMetadata, Input } from '../../../services/positronConnections/common/interfaces/positronConnectionsDriver.js';
import { IPositronConnectionsService } from '../../../services/positronConnections/common/interfaces/positronConnectionsService.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';

@extHostNamedCustomer(MainPositronContext.MainThreadConnections)
export class MainThreadConnections implements MainThreadConnectionsShape {
	private readonly _proxy: ExtHostConnectionsShape;
	private readonly _disposables = new DisposableStore();
	constructor(
		extHostContext: IExtHostContext,
		@IPositronConnectionsService private readonly _connectionsService: IPositronConnectionsService
	) {
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostConnections);
	}

	$registerConnectionDriver(driverId: string, metadata: IDriverMetadata, availableMethods: IAvailableDriverMethods): void {
		this._connectionsService.driverManager.registerDriver(new MainThreadDriverAdapter(
			driverId, metadata, availableMethods, this._proxy
		));
	}

	$removeConnectionDriver(driverId: string): void {
		this._connectionsService.driverManager.removeDriver(driverId);
	}

	dispose(): void {
		this._disposables.dispose();
	}
}

export interface IAvailableDriverMethods {
	generateCode: boolean,
	connect: boolean,
	checkDependencies: boolean,
	installDependencies: boolean
}

class MainThreadDriverAdapter implements IDriver {
	constructor(
		readonly driverId: string,
		readonly metadata: IDriverMetadata,
		private readonly availableMethods: IAvailableDriverMethods,
		private readonly _proxy: ExtHostConnectionsShape
	) { }
	get generateCode() {
		if (!this.availableMethods.generateCode) {
			return undefined;
		}
		return (inputs: Input[]) => this._proxy.$driverGenerateCode(this.driverId, inputs);
	}
	get connect() {
		if (!this.availableMethods.connect) {
			return undefined;
		}
		return (code: string) => this._proxy.$driverConnect(this.driverId, code);
	}
	get checkDependencies() {
		if (!this.availableMethods.checkDependencies) {
			return undefined;
		}
		return () => this._proxy.$driverCheckDependencies(this.driverId);
	}
	get installDependencies() {
		if (!this.availableMethods.installDependencies) {
			return undefined;
		}
		return () => this._proxy.$driverInstallDependencies(this.driverId);
	}
}
