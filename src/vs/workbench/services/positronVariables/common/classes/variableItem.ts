/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IVariableItem } from 'vs/workbench/services/positronVariables/common/interfaces/variableItem';
import { EnvironmentVariable } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEnvironmentClient';

/**
 * VariableItem class. This is used to represent an variable in a language runtime.
 */
export class VariableItem implements IVariableItem {
	//#region Private Properties

	/**
	 * Gets or sets the cached identifier.
	 */
	private _cachedId: string | undefined;

	/**
	 * Gets the variable.
	 */
	private readonly _variable: EnvironmentVariable;

	/**
	 * Gets or sets the child variable items.
	 */
	private _variableItems: Map<string, VariableItem> | undefined = undefined;

	/**
	 * Gets or sets a value which indicates whether the variable item is expanded.
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
			this._cachedId = JSON.stringify(this._variable.path);
		}

		// Return the cached identifier.
		return this._cachedId;
	}

	/**
	 * Gets the access key.
	 */
	get accessKey() {
		return this._variable.data.access_key;
	}

	/**
	 * Gets the path.
	 */
	get path() {
		return this._variable.path;
	}

	/**
	 * Gets the indent level.
	 */
	get indentLevel() {
		return this._variable.parentKeys.length;
	}

	/**
	 * Gets the display name.
	 */
	get displayName() {
		return this._variable.data.display_name;
	}

	/**
	 * Gets the display value.
	 */
	get displayValue() {
		return this._variable.data.display_value;
	}

	/**
	 * Gets the display type.
	 */
	get displayType() {
		return this._variable.data.display_type;
	}

	/**
	 * Gets the type info.
	 */
	get typeInfo() {
		return this._variable.data.type_info;
	}

	/**
	 * Gets the kind of value.
	 */
	get kind() {
		return this._variable.data.kind;
	}

	/**
	 * Gets the number of elements in the value, if applicable.
	 */
	get length() {
		return this._variable.data.length;
	}

	/**
	 * Gets the size of the variable's value, in bytes.
	 */
	get size() {
		return this._variable.data.size;
	}

	/**
	 * Gets a value which indicates whether the variable contains child variables.
	 */
	get hasChildren() {
		return this._variable.data.has_children;
	}

	/**
	 * Gets a value which indicates whether the variable has a viewer supplied
	 * by the runtime.
	 */
	get hasViewer() {
		return this._variable.data.has_viewer;
	}

	/**
	 * Gets a value which indicates whether the value is truncated.
	 */
	get isTruncated() {
		return this._variable.data.is_truncated;
	}

	/**
	 * Gets a value which indicates whether the variable item is expanded.
	 */
	get expanded() {
		return this._expanded;
	}

	/**
	 * Sets a value which indicates whether the variable item is expanded.
	 */
	set expanded(value: boolean) {
		this._expanded = value;
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param name The variable.
	 */
	constructor(variable: EnvironmentVariable) {
		this._variable = variable;
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Locates a child entry.
	 * @param path The path of the child entry to locate.
	 */
	locateChildEntry(path: string[]): VariableItem | undefined {
		// When the path is empty, return this.
		if (!path.length) {
			return this;
		}

		// Find the matching child variable item.
		const variableItem = this._variableItems?.get(path[0]);
		if (!variableItem) {
			return undefined;
		}

		// Recursively locate the child entry.
		return variableItem.locateChildEntry(path.slice(1));
	}

	/**
	 * Loads the children.
	 */
	async loadChildren(isExpanded: (path: string[]) => boolean): Promise<void> {
		// If this variable item has no children, return. (It may have had children and been
		// expanded in the past, so this can happen from time to time.)
		if (!this.hasChildren) {
			return;
		}

		// Asynchronously load the children of this this variable item.
		const environmentClientList = await this._variable.getChildren();

		// Add the children variables, recursively loading each one that is expanded.
		this._variableItems = new Map<string, VariableItem>();
		const promises: Promise<void>[] = [];
		for (const variable of environmentClientList.variables) {
			// Create and add the child variable item.
			const variableItem = new VariableItem(variable);
			this._variableItems.set(variableItem.accessKey, variableItem);

			// If the child variable item has children and is expanded, recursively load its
			// children.
			if (variableItem.hasChildren && isExpanded(variableItem.path)) {
				promises.push(variableItem.loadChildren(isExpanded));
			}
		}

		// Wait for all the child variable items to load.
		if (promises.length) {
			await Promise.all(promises);
		}
	}

	/**
	 * Flattens this variable item.
	 * @returns The flattened variable item.
	 */
	flatten(isExpanded: (path: string[]) => boolean): VariableItem[] {
		// Create the flattened variable items with this variable item as the first entry.
		const items: VariableItem[] = [this];

		// If this variable item doesn't have children, return the flattened variable items
		if (!this.hasChildren) {
			this.expanded = false;
			return items;
		}

		// Update the expanded state of this variable item.
		this.expanded = isExpanded(this._variable.path);

		// If this variable item isn't expanded or the children have not been loaded, return.
		if (!this.expanded || !this._variableItems) {
			return items;
		}

		// Recursively flatten the children of this variable item.
		for (const variableItem of this._variableItems.values()) {
			items.push(...variableItem.flatten(isExpanded));
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
		return await this._variable.formatForClipboard(mime);
	}

	/**
	 * Requests that a viewer be opened for this variable.
	 */
	async view(): Promise<void> {
		await this._variable.view();
	}

	//#endregion Public Methods
}
