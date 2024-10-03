/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ConnectionsClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeConnectionsClient';
import { IPositronConnectionsService } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsService';
import { PositronConnectionsInstance } from 'vs/workbench/services/positronConnections/browser/positronConnectionsInstance';
import { ILanguageRuntimeSession, IRuntimeSessionService, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
class PositronConnectionsService extends Disposable implements IPositronConnectionsService {

	private readonly connections: PositronConnectionsInstance[] = [];
	readonly _serviceBrand: undefined;

	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
	) {
		super();

		// Whenever a session starts, we'll register an observer that will create a ConnectionsInstance
		// whenever a new connections client is created by the backend.
		this._register(this._runtimeSessionService.onDidStartRuntime((runtime) => {
			this.attachRuntime(runtime);
		}));
	}

	initialize(): void { }

	attachRuntime(session: ILanguageRuntimeSession) {
		this._register(session.onDidCreateClientInstance(({ message, client }) => {
			if (!(client.getClientType() === RuntimeClientType.Connection)) {
				return;
			}

			if (this.hasConnection(client.getClientId())) {
				// A connection with this id is already registered.
				return;
			}

			this.addConnection(new PositronConnectionsInstance(
				new ConnectionsClientInstance(client),
				message.data as any
			));
		}));
	}

	addConnection(instance: PositronConnectionsInstance) {
		this.connections.push(instance);
	}

	getConnection(clientId: string) {
		return this.connections.find((conn) => {
			return conn.getClientId() === clientId;
		});
	}

	hasConnection(clientId: string) {
		return this.getConnection(clientId) !== undefined;
	}
}

registerSingleton(
	IPositronConnectionsService,
	PositronConnectionsService,
	InstantiationType.Delayed
);
