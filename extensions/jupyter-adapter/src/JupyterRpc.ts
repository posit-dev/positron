/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { JupyterKernel } from './JupyterKernel';
import { v4 as uuidv4 } from 'uuid';
import { JupyterMessagePacket } from './JupyterMessagePacket';
import { JupyterSockets } from './JupyterSockets';
import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents a generic Jupyter RPC request/response pair; generic over the
 * request (T) and response (U) types.
 */
export class JupyterRpc<T extends JupyterMessageSpec, U extends JupyterMessageSpec> {
	public id: string;
	constructor(
		readonly requestType: string,
		readonly request: T,
		readonly responseType: string,
		readonly responseCallback: (response: U) => void,
	) {
		// Generate a unique ID for this request
		this.id = uuidv4();
	}

	/**
	 * Send the request to the given kernel.
	 *
	 * @param k The kernel to send the request to
	 */
	public send(k: JupyterKernel) {
		const packet: JupyterMessagePacket = {
			type: 'jupyter-message',
			msgId: this.id,
			msgType: this.requestType,
			originId: '',
			message: this.request,
			socket: JupyterSockets.shell
		};
		k.sendMessage(packet);
	}

	/**
	 * Process a response to this request.
	 *
	 * @param response The response to the request
	 */
	public recv(response: U) {
		this.responseCallback(response);
	}
}

