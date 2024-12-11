/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRuntimeClientInstance } from './languageRuntimeClientInstance.js';
import { PositronUiComm } from './positronUiComm.js';

export class PositronUiCommInstance extends PositronUiComm {
	constructor(client: IRuntimeClientInstance<any, any>) {
		super(client);

		// Create a stub CallMethodReply event emitter. This allows us to
		// gracefully handle the case wherein an RPC is initiated on the
		// extension side. When the RPC reply is received, it is delivered to
		// the main thread, too, but since the main thread didn't intiate the
		// RPC, the message is unexpected and generates a warning.
		super.createEventEmitter('CallMethodReply', []);
	}
}
