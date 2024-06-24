/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a help link given from the Jupyter kernel
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#kernel-info
 */
export interface JupyterHelpLink {
	/** The name to display for the help link */
	text: string;

	/** The location (URL) of the help link */
	url: string;
}
