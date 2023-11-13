/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * IEnvironmentVariableItem interface.
 */
export interface IEnvironmentVariableItem {
	/**
	 * Gets the identifier.
	 */
	readonly id: string;

	/**
	 * Gets the path.
	 */
	readonly path: string[];

	/**
	 * Gets a value which indicates whether the environment variable has children.
	 */
	readonly hasChildren: boolean;

	/**
	 * Gets a value which indicates whether the environment variable has a
	 * viewer supplied by the runtime.
	 */
	readonly hasViewer: boolean;

	/**
	 * Gets the indent level.
	 */
	readonly indentLevel: number;

	/**
	 * Gets the display name.
	 */
	readonly displayName: string;

	/**
	 * Gets the display value.
	 */
	readonly displayValue: string;

	/**
	 * Gets the display type.
	 */
	readonly displayType: string;

	/**
	 * Gets the variable's kind.
	 */
	readonly kind: string;

	/**
	 * Gets the size.
	 */
	readonly size: number;

	/**
	 * Gets a value which indicates whether the environment variable is expanded.
	 */
	readonly expanded: boolean;

	/**
	 * Formats the value of this variable in a format suitable for placing on the clipboard.
	 * @param mime The desired MIME type of the format, such as 'text/plain' or 'text/html'.
	 * @returns A promise that resolves to the formatted value of this variable.
	 */
	formatForClipboard(mime: string): Promise<string>;

	/**
	 * Requests that a data viewer be opened for this variable.
	 */
	view(): Promise<void>;
}
