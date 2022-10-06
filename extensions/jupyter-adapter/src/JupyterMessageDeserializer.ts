/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createHmac } from 'crypto';
import { JupyterMessage } from './JupyterMessage';
import * as vscode from 'vscode';

/**
 * Deserializes a Jupyter wire protocol message received from a ZeroMQ socket.
 *
 * @param message The raw message buffer array.
 * @param key The pre-shared HMAC-256 signing key for the message.
 * @param channel An output channel on which to emit diagnostic warnings.
 *
 * @returns The decoded `JupyterMessage`
 */
export function deserializeJupyterMessage(message: any[], key: string, channel: vscode.OutputChannel): JupyterMessage | null {

	// Discard the ZeroMQ socket identities, which are the elements of the array
	// before the <IDS|MSG> token.
	let found = false;
	while (message.length > 0) {
		const ele = message.splice(0, 1)[0];
		if (ele?.toString() === '<IDS|MSG>') {
			found = true;
			break;
		}
	}

	if (!found) {
		channel.appendLine('WARNING: Message received from kernel with no header.');
		return null;
	}

	// Extract fields
	const signature = message[0]!.toString();
	const header = message[1]!.toString();
	const parent = message[2]!.toString();
	const metadata = message[3]!.toString();
	const content = message[4]!.toString();

	// Double-check signature
	const hmac = createHmac('sha256', key);
	hmac.update(header);
	hmac.update(parent);
	hmac.update(metadata);
	hmac.update(content);
	const computed = hmac.digest('hex').toString();
	if (computed !== signature) {
		channel.appendLine(`Expected message signature ${computed} doesn't match actual signature ${signature}`);
		// TODO: we should totally reject the message in this case
	}

	const msg: JupyterMessage = {
		header: JSON.parse(header),
		parent_header: JSON.parse(parent), // eslint-disable-line
		metadata: JSON.parse(metadata),
		content: JSON.parse(content),

		// TODO: Do we need to pass buffers?
		buffers: []
	};

	return msg;
}
