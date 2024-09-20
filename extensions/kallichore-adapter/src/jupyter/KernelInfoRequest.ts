/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents an kernel_info_request to the kernel.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#execute
 */
export class KernelInfoRequest extends JupyterMessageSpec<Object> {
	constructor() {
		super('kernel_info_request', JupyterChannel.Shell);
	}
	override content() {
		return {};
	}
}
