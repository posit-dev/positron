/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { ContextKeyExpression } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ObservableMap } from '../../../../../../base/common/observable.js';
import { ILocalizedString } from '../../../../../../platform/action/common/action.js';
import { CellConditionPredicate } from './cellConditions.js';


/**
 * The position of a cell action bar item.
 */
export type CellActionPosition = 'main' | 'main-right' | 'menu' | 'left';
/**
 * Interface for notebook cell action bar items that define how commands appear in the UI.
 */
export interface INotebookCellActionBarItem {
	/** VS Code command ID to execute */
	commandId: string;
	/** Command label, for display purposes, if not defined, use the commandId */
	label?: ILocalizedString | string;
	/** Codicon class for the button icon (optional) */
	icon?: string;
	/** Location in UI - main action bar, main-right action bar, dropdown menu, or left action bar */
	position: CellActionPosition;
	/** Sort order within position (lower numbers appear first) */
	order?: number;
	/** Visibility condition using VS Code context keys (optional) */
	when?: ContextKeyExpression;
	/** Cell-specific condition that determines if this command applies to a given cell */
	cellCondition?: CellConditionPredicate;
	/** Category of the action bar item. Items that share the same category will be grouped together. */
	category?: string;
}


// Default order for actions that don't specify an order.
const DEFAULT_ORDER = 50;

/**
 * Registry for notebook cell action bar items. Uses singleton pattern and provides
 * observable arrays for reactive UI updates.
 */
export class NotebookCellActionBarRegistry {
	private static instance: NotebookCellActionBarRegistry;
	private items = new ObservableMap<string, INotebookCellActionBarItem>();

	/**
	 * The observable array of main action bar actions.
	 */
	public readonly mainActions;

	/**
	 * The observable array of main-right action bar actions.
	 */
	public readonly mainRightActions;

	/**
	 * The observable array of dropdown menu actions.
	 */
	public readonly menuActions;

	/**
	 * The observable array of left action bar actions.
	 */
	public readonly leftActions;

	constructor() {
		this.mainActions = this.items.observable.map(this, items =>
			/** @description mainActions */
			Array.from(items.values())
				.filter(item => item.position === 'main')
				.sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER))
		);

		this.mainRightActions = this.items.observable.map(this, items =>
			/** @description mainRightActions */
			Array.from(items.values())
				.filter(item => item.position === 'main-right')
				.sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER))
		);

		this.menuActions = this.items.observable.map(this, items =>
			/** @description menuActions */
			Array.from(items.values())
				.filter(item => item.position === 'menu')
				.sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER))
		);

		this.leftActions = this.items.observable.map(this, items =>
			/** @description leftActions */
			Array.from(items.values())
				.filter(item => item.position === 'left')
				.sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER))
		);
	}

	/**
	 * Gets the singleton instance of the registry.
	 */
	static getInstance(): NotebookCellActionBarRegistry {
		if (!this.instance) {
			this.instance = new NotebookCellActionBarRegistry();
		}
		return this.instance;
	}

	/**
	 * Registers an action bar item in the registry.
	 * @param item The action bar item to register
	 * @returns A disposable to unregister the item
	 */
	register(item: INotebookCellActionBarItem): IDisposable {
		this.items.set(item.commandId, item);
		return {
			dispose: () => {
				this.items.delete(item.commandId);
			}
		};
	}
}
