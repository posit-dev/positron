/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { JupyterRequest } from './JupyterRequest';
import { JupyterChannel } from './JupyterChannel';
import { JupyterMessageType } from './JupyterMessageType.js';

export class DebugRequest extends JupyterRequest<positron.DebugProtocolRequest, positron.DebugProtocolResponse> {
	constructor(req: positron.DebugProtocolRequest) {
		super(JupyterMessageType.DebugRequest, req, JupyterMessageType.DebugReply, JupyterChannel.Control);
	}
}
