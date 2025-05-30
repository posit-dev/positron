/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageType } from './JupyterMessageType.js';

/**
 * Represents the message header for messages inbound to a Jupyter kernel.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#message-header
 */
export interface JupyterMessageHeader {
	/** The message ID, must be unique per message. */
	msg_id: string;

	/** Session ID, must be unique per session */
	session: string;

	/** Username, must be unique per user */
	username: string;

	/** Date/Time when message was created in ISO 8601 format */
	date: string;

	/** The message type */
	msg_type: JupyterMessageType;

	/** The message protocol version */
	version: string;
}
