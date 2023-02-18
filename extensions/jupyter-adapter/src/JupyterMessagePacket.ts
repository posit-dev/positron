/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageSpec } from './JupyterMessageSpec';
import { JupyterSockets } from './JupyterSockets';

/**
 * Represents a serialized message packet. This plain data structure wraps the
 * Jupyter messages delivered via postmessage across the extension's window
 * boundary.
 */
export interface JupyterMessagePacket {
	/** The type of the message packet; it's always `jupyter-message` to
	 * distinguish this from other messages delivered across the window boundary */
	type: 'jupyter-message';

	/** The message's ID, a UUID */
	msgId: string;

	/** The message's Jupyter message type, like 'execute_request' */
	msgType: string;

	/** The ID of the message that triggered this one */
	originId: string;

	/** The date and time the message was emitted, in ISO 8061 format */
	when: string;

	/** The message itself */
	message: JupyterMessageSpec;

	/** The socket on which the message was received, or is to be sent */
	socket: JupyterSockets;
}
