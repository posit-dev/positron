/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { ContextKeyExpression } from '../../../../../../platform/contextkey/common/contextkey.js';
import { derived, IObservable, ObservableMap } from '../../../../../../base/common/observable.js';
import { ILocalizedString } from '../../../../../../platform/action/common/action.js';
import { CellConditionPredicate } from './cellConditions.js';

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
	/** Location in UI - either main action bar or dropdown menu */
	position: 'main' | 'menu';
	/** Sort order within position (lower numbers appear first) */
	order?: number;
	/** Visibility condition using VS Code context keys (optional) */
	when?: ContextKeyExpression;
	/** If true, the cell will be selected before executing the command */
	needsCellContext?: boolean;
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

	// Observable arrays for reactive UI updates
	private _mainActions;
	private _menuActions;

	constructor() {
		this._mainActions = derived(this, reader => {
			/** @description mainActions */
			return Array.from(this.items.observable.read(reader).values())
				.filter(item => item.position === 'main')
				.sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER));
		});

		this._menuActions = derived(this, reader => {
			/** @description menuActions */
			return Array.from(this.items.observable.read(reader).values())
				.filter(item => item.position === 'menu')
				.sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER));
		});
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

	/**
	 * Gets the observable array of main action bar actions.
	 */
	get mainActions(): IObservable<INotebookCellActionBarItem[]> {
		return this._mainActions;
	}

	/**
	 * Gets the observable array of dropdown menu actions.
	 */
	get menuActions(): IObservable<INotebookCellActionBarItem[]> {
		return this._menuActions;
	}
}
