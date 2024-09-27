/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterMessageHeader } from './JupyterMessageHeader';

/**
 * Represents a message to or from the front end to Jupyter.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#a-full-message
 */
export interface JupyterMessage {

	/** The message header */
	header: JupyterMessageHeader;

	/** The parent message (the one that caused this one), if any */
	parent_header: JupyterMessageHeader;    // eslint-disable-line

	/** Additional metadata, if any */
	metadata: Map<any, any>;

	/** The body of the message */
	content: any;

	/**
	 * The channel (ZeroMQ socket) for the message. This isn't part of the
	 * formal Jupyter protocol; it is used to route websocket messages to/from
	 * the correct ZeroMQ socket.
	 */
	channel: JupyterChannel;

	/** Additional binary data */
	buffers: Array<Uint8Array>;
}
