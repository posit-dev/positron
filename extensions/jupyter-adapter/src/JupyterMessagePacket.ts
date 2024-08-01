/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
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

	/** Additional metadata, if any */
	metadata?: Map<any, any>;

	/** Additional binary data, if any */
	buffers?: Array<Uint8Array>;
}
