/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ConnectionsClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeConnectionsClient';
import { IPositronConnectionInstance } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';


export class PositronConnectionsInstance extends Disposable implements IPositronConnectionInstance {
	onToggleExpandEmitter: Emitter<void> = new Emitter<void>();
	onToggleExpand: Event<void> = this.onToggleExpandEmitter.event;

	constructor(
		private readonly client: ConnectionsClientInstance,
		private readonly metadata: ConnectionMetadata
	) {
		super();
	}

	getClientId() {
		return this.client.getClientId();
	}

	getMetadata() {
		return this.metadata;
	}

	getChildren() {
		return [];
	}

	hasChildren() {
		return false;
	}

	name() {
		return this.metadata.name;
	}

	icon() {
		if (!this.metadata.icon) {
			return 'database';
		}

		return this.metadata.icon;
	}

	expanded() {
		return false;
	}
}

interface ConnectionMetadata {
	name: string;
	language_id: string;
	// host and type are used to identify a unique connection
	host: string;
	type: string;
	code?: string;
	icon?: string; // base64 encoded icon image (if available)
}
