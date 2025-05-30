/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a Jupyter display data message.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#display-data
 */
export interface JupyterDisplayData {
	/** The data dict contains key/value pairs, where the keys are MIME
	 * types and the values are the raw data of the representation in that
	 * format.
	 */
	data: Record<string, unknown>;

	/** Any metadata that describes the data. */
	metadata: Record<string, unknown>;

	/**
	 * Optional transient data introduced in 5.1. Information not to be
	 * persisted to a notebook or other documents. Intended to live only
	 * during a live kernel session.
	 */
	transient?: {
		/**
		 * The optional identifier of the display, which may be referenced
		 * in future display_data or update_display_data messages.
		 */
		display_id?: string;

		[key: string]: unknown;
	};
}
