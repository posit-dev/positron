/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents metadata associated with the language supported by the kernel.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#kernel-info
 */
export interface JupyterLanguageInfo {
	/** The name of the programming language the kernel implements */
	name: string;

	/** The version of the language */
	version: string;

	/** The MIME type for script files in the language */
	mimetype: string;

	/** The file extension for script files in the language */
	file_extension: string; // eslint-disable-line

	/** Pygments lexer (for highlighting), only needed if differs from name */
	pygments_lexer: string; // eslint-disable-line

	/** Codemirror mode (for editing), only needed if differs from name  */
	codemirror_mode: string; // eslint-disable-line

	/** Nbconvert exporter, if not default */
	nbconvert_exporter: string; // eslint-disable-line
}
