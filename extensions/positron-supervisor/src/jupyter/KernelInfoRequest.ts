/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterHelpLink } from './JupyterHelpLink';
import { JupyterLanguageInfo } from './JupyterLanguageInfo';
import { JupyterMessageType } from './JupyterMessageType.js';
import { JupyterRequest } from './JupyterRequest';

/**
 * Represents an kernel_info_request to the kernel.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#execute
 */
export class KernelInfoRequest extends JupyterRequest<Object, KernelInfoReply> {
	constructor() {
		super(JupyterMessageType.KernelInfoRequest, {}, JupyterMessageType.KernelInfoReply, JupyterChannel.Shell);
	}
}

export interface KernelInfoReply {
	/** Execution status */
	status: 'ok' | 'error';

	/** Version of messaging protocol */
	protocol_version: string;

	/** Implementation version number */
	implementation_version: string;

	/** Information about the language the kernel supports */
	language_info: JupyterLanguageInfo;

	/** A startup banner */
	banner: string;

	/** Whether debugging is supported */
	debugger: boolean;

	/** A list of help links */
	help_links: Array<JupyterHelpLink>;

	/** A list of optional features such as 'debugger' and 'kernel subshells' */
	supported_features: Array<string>;
}
