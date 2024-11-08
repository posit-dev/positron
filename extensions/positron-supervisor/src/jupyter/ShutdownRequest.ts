/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterRequest } from './JupyterRequest';
import { JupyterShutdownReply } from './JupyterShutdownReply';
import { JupyterShutdownRequest } from './JupyterShutdownRequest';

export class ShutdownRequest extends JupyterRequest<JupyterShutdownRequest, JupyterShutdownReply> {
	constructor(restart: boolean) {
		super('shutdown_request', { restart }, 'shutdown_reply', JupyterChannel.Control);
	}
}
