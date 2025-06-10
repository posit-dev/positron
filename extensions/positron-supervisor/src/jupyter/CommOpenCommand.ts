/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterCommand } from './JupyterCommand';
import { JupyterCommOpen } from './JupyterCommOpen';
import { JupyterMessageType } from './JupyterMessageType.js';

/**
 * Represents a comm_open command sent to the kernel
 */
export class CommOpenCommand extends JupyterCommand<JupyterCommOpen> {
	/**
	 * Create a new comm_open command
	 *
	 * @param payload The payload of the command; contains initial data sent to
	 * the comm
	 * @param _metadata The metadata for the message
	 */
	constructor(payload: JupyterCommOpen, private readonly _metadata?: Record<string, unknown>) {
		super(JupyterMessageType.CommOpen, payload, JupyterChannel.Shell);
	}

	override get metadata(): Record<string, unknown> {
		// If we don't have metadata, return an empty object to ensure the
		// metadata field is sent
		if (typeof this._metadata === 'undefined') {
			return {};
		}
		return this._metadata;
	}
}
