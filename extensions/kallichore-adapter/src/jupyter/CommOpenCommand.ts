/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterCommand } from './JupyterCommand';
import { JupyterCommOpen } from './JupyterCommOpen';

export class CommOpenCommand extends JupyterCommand<JupyterCommOpen> {
	constructor(payload: JupyterCommOpen) {
		super('comm_open', payload, JupyterChannel.Shell);
	}
}
