/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { JupyterHelpLink } from './JupyterHelpLink';
import { JupyterLanguageInfo } from './JupyterLanguageInfo';
import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents an kernel_info_reply from the kernel.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#execute
 */
export interface JupyterKernelInfoReply extends JupyterMessageSpec {
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
