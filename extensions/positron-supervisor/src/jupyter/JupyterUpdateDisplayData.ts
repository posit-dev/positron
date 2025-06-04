/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a Jupyter update display data message.
 *
 * @link https://jupyter-client.readthedocs.io/en/latest/messaging.html#update-display-data
 */
export interface JupyterUpdateDisplayData {
	/**
	 * The data dict contains key/value pairs, where the keys are MIME
	 * types and the values are the raw data of the representation in that
	 * format. */
	data: Record<string, unknown>;

	/** Any metadata that describes the data. */
	metadata: Record<string, unknown>;

	/**
	 * Any information not to be persisted to a notebook or other environment
	 * Intended to live only during a kernel session
	 */
	transient: {
		/** The identifier of the display to update. */
		display_id: string;

		[key: string]: unknown;
	};
}
