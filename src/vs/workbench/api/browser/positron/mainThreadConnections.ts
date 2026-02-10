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
	generateCode: boolean;
	connect: boolean;
	checkDependencies: boolean;
	installDependencies: boolean;
}

class MainThreadDriverAdapter implements IDriver {
	readonly generateCode?: (inputs: Input[]) => Promise<string | { code: string; errorMessage: string }>;
	readonly connect?: (code: string) => Promise<void>;
	readonly checkDependencies?: () => Promise<boolean>;
	readonly installDependencies?: () => Promise<boolean>;

	constructor(
		readonly driverId: string,
		readonly metadata: IDriverMetadata,
		availableMethods: IAvailableDriverMethods,
		proxy: ExtHostConnectionsShape
	) {
		// Create stable function references once in the constructor
		if (availableMethods.generateCode) {
			this.generateCode = (inputs: Input[]) => proxy.$driverGenerateCode(driverId, inputs);
		}
		if (availableMethods.connect) {
			this.connect = (code: string) => proxy.$driverConnect(driverId, code);
		}
		if (availableMethods.checkDependencies) {
			this.checkDependencies = () => proxy.$driverCheckDependencies(driverId);
		}
		if (availableMethods.installDependencies) {
			this.installDependencies = () => proxy.$driverInstallDependencies(driverId);
		}
	}
}
