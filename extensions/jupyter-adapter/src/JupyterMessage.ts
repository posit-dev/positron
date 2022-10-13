/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { JupyterMessageHeader } from './JupyterMessageHeader';
import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents a message from the front end to Jupyter.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#a-full-message
 */
export interface JupyterMessage {

	/** The message header */
	header: JupyterMessageHeader;

	/** The parent message (the one that caused this one), if any */
	parent_header: JupyterMessageHeader;    // eslint-disable-line

	/** Additional metadata, if any */
	metadata: Map<any, any>;

	/** The body of the message */
	content: JupyterMessageSpec;

	/** Additional binary data */
	buffers: Array<Buffer>;
}
