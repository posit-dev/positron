/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterHelpLink } from './JupyterHelpLink';
import { JupyterLanguageInfo } from './JupyterLanguageInfo';
import { JupyterRequest } from './JupyterRequest';

/**
 * Represents an kernel_info_request to the kernel.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#execute
 */
export class KernelInfoRequest extends JupyterRequest<Object, KernelInfoReply> {
	constructor() {
		super('kernel_info_request', {}, 'kernel_info_reply', JupyterChannel.Shell);
	}
}

export interface KernelInfoReply {
	/** Execution status */
	status: 'ok' | 'error';

	/** Version of messaging protocol */
	protocol_version: string;  // eslint-disable-line

	/** Implementation version number */
	implementation_version: string;  // eslint-disable-line

	/** Information about the language the kernel supports */
	language_info: JupyterLanguageInfo;  // eslint-disable-line

	/** A startup banner */
	banner: string;

	/** Whether debugging is supported */
	debugger: boolean;

	/** A list of help links */
	help_links: Array<JupyterHelpLink>;  // eslint-disable-line
}
