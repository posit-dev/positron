/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterCommMsg } from './JupyterCommMsg';
import { JupyterMessageType } from './JupyterMessageType.js';
import { JupyterRequest } from './JupyterRequest';

export class CommMsgRequest extends JupyterRequest<JupyterCommMsg, JupyterCommMsg> {
	constructor(private readonly _id: string, payload: JupyterCommMsg) {
		super(JupyterMessageType.CommMsg, payload, JupyterMessageType.CommMsg, JupyterChannel.Shell);
	}

	protected override createMsgId(): string {
		return this._id;
	}
}
