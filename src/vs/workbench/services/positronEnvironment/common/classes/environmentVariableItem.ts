/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { EnvironmentVariable } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEnvironmentClient';
import { IEnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableItem';
import { PositronEnvironmentSorting } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';
import { sortEnvironmentVariableItemsByName, sortEnvironmentVariableItemsBySize } from 'vs/workbench/services/positronEnvironment/common/helpers/utils';

/**
 * EnvironmentVariableItem class. This is used to represent an EnvironmentVariable in a language
 * runtime.
 */
export class EnvironmentVariableItem implements IEnvironmentVariableItem {
	//#region Private Properties

	/**
	 * Gets the environment variable.
	 */
	private readonly _environmentVariable: EnvironmentVariable;

	/**
	 * Gets or sets the child environment variable items.
	 */
	private _environmentVariableItems: EnvironmentVariableItem[] | undefined = undefined;

	/**
	 * Gets or sets a value which indicates whether the environment variable item is expanded.
	 */
	private _expanded = false;

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the identifier.
	 */
	readonly id = generateUuid();

	/**
	 * Gets the path.
	 */
	get path() {
		return this._environmentVariable.path;
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
	 * Loads the children.
	 */
	async loadChildren(): Promise<void> {
		// If the environment variable has no children, return.
		if (!this.hasChildren) {
			return;
		}

		// Asynchronously load the children.
		const environmentClientList = await this._environmentVariable.getChildren();
		this._environmentVariableItems = environmentClientList.variables.map(environmentVariable =>
			new EnvironmentVariableItem(environmentVariable)
		);
	}

	/**
	 * Flattens this environment variable item.
	 * @param sorting The sorting.
	 * @returns The flattened environment variable item.
	 */
	flatten(isExpanded: (path: string) => boolean, sorting: PositronEnvironmentSorting): EnvironmentVariableItem[] {
		// Create the flattened environment variable items with this item as the first entry.
		const items: EnvironmentVariableItem[] = [this];

		// Update the expanded state.
		if (!this.hasChildren) {
			return items;
		}

		this.expanded = isExpanded(JSON.stringify(this._environmentVariable.path));

		// If this environment variable isn't expanded or the children have not been loaded, return.
		if (!this.expanded || !this._environmentVariableItems) {
			return items;
		}

		// Sort the children of this item in place.
		switch (sorting) {
			// Name.
			case PositronEnvironmentSorting.Name:
				sortEnvironmentVariableItemsByName(this._environmentVariableItems);
				break;

			// Size.
			case PositronEnvironmentSorting.Size:
				sortEnvironmentVariableItemsBySize(this._environmentVariableItems);
				break;
		}

		// Recursively flatten the children.
		for (const item of this._environmentVariableItems) {
			items.push(...item.flatten(isExpanded, sorting));
		}

		// Done.
		return items;
	}

	//#endregion Public Methods
}
