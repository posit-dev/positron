/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterCommand } from './JupyterCommand';
import { JupyterMessageHeader } from './JupyterMessageHeader';


export class InputReplyCommand extends JupyterCommand<JupyterInputReply> {
	/**
	 * Construct a new input reply
	 *
	 * @param parent The parent message header, if any
	 * @param value The value the user entered for the input request
	 */
	constructor(readonly parent: JupyterMessageHeader | null, value: string) {
		super('input_reply', { value }, JupyterChannel.Stdin);
	}

	protected override createParentHeader(): JupyterMessageHeader | null {
		return this.parent;
	}
}

/**
 * Represents a input_reply sent to the kernel
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#messages-on-the-stdin-router-dealer-channel
 */
export interface JupyterInputReply {
	/** The value the user entered for the input request */
	value: string;
}
