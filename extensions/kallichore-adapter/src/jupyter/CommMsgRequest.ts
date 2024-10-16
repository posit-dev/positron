/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterCommMsg } from './JupyterCommMsg';
import { JupyterRequest } from './JupyterRequest';

export class CommMsgRequest extends JupyterRequest<JupyterCommMsg, JupyterCommMsg> {
	constructor(private readonly _id: string, payload: JupyterCommMsg) {
		super('comm_msg', payload, 'comm_msg', JupyterChannel.Shell);
	}

	protected override createMsgId(): string {
		return this._id;
	}
}
