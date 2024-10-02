/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ConnectionsClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeConnectionsClient';


export class PositronConnectionsInstance extends Disposable implements PositronConnectionsInstance {
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
