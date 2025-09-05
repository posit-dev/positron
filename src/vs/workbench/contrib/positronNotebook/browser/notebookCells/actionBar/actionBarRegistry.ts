/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { ContextKeyExpression } from '../../../../../../platform/contextkey/common/contextkey.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { ISettableObservable, observableValue } from '../../../../../../base/common/observable.js';
import { ILocalizedString } from '../../../../../../platform/action/common/action.js';
import { CellConditionPredicate } from './cellConditions.js';


/**
 * The position of a cell action bar item.
 */
export type CellActionPosition = 'main' | 'menu' | 'left';
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
	private items = new Map<string, INotebookCellActionBarItem>();

	// Observable arrays for reactive UI updates
	private _mainActions = observableValue<INotebookCellActionBarItem[]>('mainActions', []);
	private _menuActions = observableValue<INotebookCellActionBarItem[]>('menuActions', []);
	private _leftActions = observableValue<INotebookCellActionBarItem[]>('leftActions', []);

	// Event emitter for changes
	private _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

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
		this.updateObservables();
		this._onDidChange.fire();

		return {
			dispose: () => {
				this.items.delete(item.commandId);
				this.updateObservables();
				this._onDidChange.fire();
			}
		};
	}

	/**
	 * Updates the observable arrays based on the current items.
	 */
	private updateObservables(): void {
		// Update main actions
		const mainActions = Array.from(this.items.values())
			.filter(item => item.position === 'main')
			.sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER));
		this._mainActions.set(mainActions, undefined);

		// Update menu actions
		const menuActions = Array.from(this.items.values())
			.filter(item => item.position === 'menu')
			.sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER));
		this._menuActions.set(menuActions, undefined);

		// Update left actions
		const leftActions = Array.from(this.items.values())
			.filter(item => item.position === 'left')
			.sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER));
		this._leftActions.set(leftActions, undefined);
	}

	/**
	 * Gets the observable array of main action bar actions.
	 */
	get mainActions(): ISettableObservable<INotebookCellActionBarItem[]> {
		return this._mainActions;
	}

	/**
	 * Gets the observable array of dropdown menu actions.
	 */
	get menuActions(): ISettableObservable<INotebookCellActionBarItem[]> {
		return this._menuActions;
	}

	/**
	 * Gets the observable array of left-positioned actions.
	 */
	get leftActions(): ISettableObservable<INotebookCellActionBarItem[]> {
		return this._leftActions;
	}
}
