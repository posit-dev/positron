/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents the message header for messages inbound to a Jupyter kernel.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#message-header
 */
export interface JupyterMessageHeader {
	/** The message ID, must be unique per message. */
	msg_id: string;   // eslint-disable-line

	/** Session ID, must be unique per session */
	session: string;

	/** Username, must be unique per user */
	username: string;

	/** Date/Time when message was created in ISO 8601 format */
	date: string;

	/** The message type (TODO: should keysof an enum) */
	msg_type: string;   // eslint-disable-line

	/** The message protocol version */
	version: string;
}
