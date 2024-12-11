/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRuntimeClientInstance } from './languageRuntimeClientInstance.js';
import { ObjectSchema, PositronConnectionsComm } from './positronConnectionsComm.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

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

	async listObjects(path: ObjectSchema[]) {
		return await this._positronConnectionsComm.listObjects(path);
	}

	async listFields(path: ObjectSchema[]) {
		return await this._positronConnectionsComm.listFields(path);
	}

	async containsData(path: ObjectSchema[]) {
		return await this._positronConnectionsComm.containsData(path);
	}

	async getIcon(path: ObjectSchema[]) {
		return await this._positronConnectionsComm.getIcon(path);
	}

	async previewObject(path: ObjectSchema[]) {
		await this._positronConnectionsComm.previewObject(path);
	}

	async getMetadata() {
		return await this._positronConnectionsComm.getMetadata(this._positronConnectionsComm.clientId);
	}

	get onDidClose() {
		return this._positronConnectionsComm.onDidClose;
	}

	get onDidFocus() {
		return this._positronConnectionsComm.onDidFocus;
	}
}
