/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { EnvironmentVariable } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEnvironmentClient';
import { IEnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableItem';

/**
 * EnvironmentVariableItem class. This is used to represent an EnvironmentVariable in a language
 * runtime.
 */
export class EnvironmentVariableItem implements IEnvironmentVariableItem {
	//#region Private Properties

	/**
	 * Gets or sets the cached identifier.
	 */
	private _cachedId: string | undefined;

	/**
	 * Gets the environment variable.
	 */
	private readonly _environmentVariable: EnvironmentVariable;

	/**
	 * Gets or sets the child environment variable items.
	 */
	private _environmentVariableItems: Map<string, EnvironmentVariableItem> | undefined = undefined;

	/**
	 * Gets or sets a value which indicates whether the environment variable item is expanded.
	 */
	private _expanded = false;

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the identifier.
	 */
	get id() {
		// If the cached identifier hasn't been set yet, set it.
		if (!this._cachedId) {
			this._cachedId = JSON.stringify(this._environmentVariable.path);
		}

		// Return the cached identifier.
		return this._cachedId;
	}

	/**
	 * Gets the access key.
	 */
	get accessKey() {
		return this._environmentVariable.data.access_key;
	}

	/**
	 * Gets the path.
	 */
	get path() {
		return this._environmentVariable.path;
	}

	/**
	 * Gets the indent level.
	 */
	get indentLevel() {
		return this._environmentVariable.parentKeys.length;
	}

	/**
	 * Gets the display name.
	 */
	get displayName() {
		return this._environmentVariable.data.display_name;
	}

	/**
	 * Gets the display value.
	 */
	get displayValue() {
		return this._environmentVariable.data.display_value;
	}

	/**
	 * Gets the display type.
	 */
	get displayType() {
		return this._environmentVariable.data.display_type;
	}

	/**
	 * Gets the type info.
	 */
	get typeInfo() {
		return this._environmentVariable.data.type_info;
	}

	/**
	 * Gets the kind of value.
	 */
	get kind() {
		return this._environmentVariable.data.kind;
	}

	/**
	 * Gets the number of elements in the value, if applicable.
	 */
	get length() {
		return this._environmentVariable.data.length;
	}

	/**
	 * Gets the size of the variable's value, in bytes.
	 */
	get size() {
		return this._environmentVariable.data.size;
	}

	/**
	 * Gets a value which indicates whether the variable contains child variables.
	 */
	get hasChildren() {
		return this._environmentVariable.data.has_children;
	}

	/**
	 * Gets a value which indicates whether the variable has a viewer supplied
	 * by the runtime.
	 */
	get hasViewer() {
		return this._environmentVariable.data.has_viewer;
	}

	/**
	 * Gets a value which indicates whether the value is truncated.
	 */
	get isTruncated() {
		return this._environmentVariable.data.is_truncated;
	}

	/**
	 * Gets a value which indicates whether the environment variable is expanded.
	 */
	get expanded() {
		return this._expanded;
	}

	/**
	 * Sets a value which indicates whether the environment variable is expanded.
	 */
	set expanded(value: boolean) {
		this._expanded = value;
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param name The environment variable.
	 */
	constructor(environmentVariable: EnvironmentVariable) {
		this._environmentVariable = environmentVariable;
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Locates a child entry.
	 * @param path The path of the child entry to locate.
	 */
	locateChildEntry(path: string[]): EnvironmentVariableItem | undefined {
		// When the path is empty, return this.
		if (!path.length) {
			return this;
		}

		// Find the matching child environment variable item.
		const environmentVariableItem = this._environmentVariableItems?.get(path[0]);
		if (!environmentVariableItem) {
			return undefined;
		}

		// Recursively find the child entry.
		return environmentVariableItem.locateChildEntry(path.slice(1));
	}

	/**
	 * Loads the children.
	 */
	async loadChildren(isExpanded: (path: string[]) => boolean): Promise<void> {
		// If this environment variable item has no children, return. (It may have had children and
		// been expanded in the past, so this can happen from time to time.)
		if (!this.hasChildren) {
			return;
		}

		// Asynchronously load the children of this this environment variable item.
		const environmentClientList = await this._environmentVariable.getChildren();

		// Add the children environment variables, recursively loading each one that is expanded.
		this._environmentVariableItems = new Map<string, EnvironmentVariableItem>();
		const promises: Promise<void>[] = [];
		for (const environmentVariable of environmentClientList.variables) {
			// Create and add the child environment variable item.
			const environmentVariableItem = new EnvironmentVariableItem(environmentVariable);
			this._environmentVariableItems.set(
				environmentVariableItem.accessKey,
				environmentVariableItem
			);

			// If the child environment variable item has children and is expanded, recursively load
			// its children.
			if (environmentVariableItem.hasChildren && isExpanded(environmentVariableItem.path)) {
				promises.push(environmentVariableItem.loadChildren(isExpanded));
			}
		}

		// Wait for all the child environment variables to load.
		if (promises.length) {
			await Promise.all(promises);
		}
	}

	/**
	 * Flattens this environment variable item.
	 * @returns The flattened environment variable item.
	 */
	flatten(isExpanded: (path: string[]) => boolean): EnvironmentVariableItem[] {
		// Create the flattened environment variable items with this environment variable item as
		// the first entry.
		const items: EnvironmentVariableItem[] = [this];

		// If this environment variable item doesn't have children, return the flattened environment
		// variable items
		if (!this.hasChildren) {
			this.expanded = false;
			return items;
		}

		// Update the expanded state of this environment variable item.
		this.expanded = isExpanded(this._environmentVariable.path);

		// If this environment variable item isn't expanded or the children have not been loaded,
		// return.
		if (!this.expanded || !this._environmentVariableItems) {
			return items;
		}

		// Recursively flatten the children of this environment variable item.
		for (const environmentVariableItem of this._environmentVariableItems.values()) {
			items.push(...environmentVariableItem.flatten(isExpanded));
		}

		// Done.
		return items;
	}

	/**
	 * Formats the value of this variable in a format suitable for placing on the clipboard.
	 * @param mime The desired MIME type of the format, such as 'text/plain' or 'text/html'.
	 * @returns A promise that resolves to the formatted value of this variable.
	 */
	async formatForClipboard(mime: string): Promise<string> {
		return await this._environmentVariable.formatForClipboard(mime);
	}

	/**
	 * Requests that a viewer be opened for this variable.
	 */
	async view(): Promise<void> {
		await this._environmentVariable.view();
	}

	//#endregion Public Methods
}
