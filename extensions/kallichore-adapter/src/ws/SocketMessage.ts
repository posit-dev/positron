/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a message sent over a WebSocket connection from Kallichore and
 * received by Positron. Today, Kallichore only sends two kinds of messages.
 */
export enum SocketMessageKind {
	/** Jupyter messages are messages conforming to the Jupyter protocol. */
	Jupyter = 'jupyter',

	/** Kernel messages are messages sent by Kallichore to deliver kernel status
	 * and metadata. */
	Kernel = 'kernel',
}

/**
 * Represents a message received from a WebSocket connection. Every message sent
 */
export interface SocketMessage {
	/** The kind of message */
	kind: SocketMessageKind;
}
