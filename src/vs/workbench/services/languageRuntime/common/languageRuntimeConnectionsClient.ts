/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { PositronConnectionsComm } from 'vs/workbench/services/languageRuntime/common/positronConnectionsComm';
import { Disposable } from 'vs/base/common/lifecycle';

export class ConnectionsClientInstance extends Disposable {
	private readonly _positronConnectionsComm: PositronConnectionsComm;

	constructor(client: IRuntimeClientInstance<any, any>) {
		super();

		this._positronConnectionsComm = new PositronConnectionsComm(client);
		this._register(this._positronConnectionsComm);
	}

	getClientId() {
		return this._positronConnectionsComm.clientId;
	}
}
