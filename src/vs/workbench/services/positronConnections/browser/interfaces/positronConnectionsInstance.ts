/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConnectionsClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeConnectionsClient';

export interface IPositronConnectionInstance {
	readonly connectionsClientInstance: ConnectionsClientInstance;
}
