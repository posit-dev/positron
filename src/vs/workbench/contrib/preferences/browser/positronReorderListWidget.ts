/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { applyDragImage } from '../../../../base/browser/ui/dnd/dnd.js';
import { IAction } from '../../../../base/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IListDataItem, ListSettingWidget } from './settingsWidgets.js';
import './media/positronSettingsListReorder.css';

const $ = DOM.$;

export interface IReorderListItem extends IListDataItem {
	/** Text shown for the row; the value is what gets saved. */
	label: string;
}

/**
 * A list setting whose rows are fixed: the user can only reorder them, by drag,
 * the Move Up/Down buttons, or Alt+Up/Down.
 */
export class PositronReorderListWidget extends ListSettingWidget<IReorderListItem> {
	private dragSourceIndex: number | undefined;

	constructor(
		container: HTMLElement,
		@IThemeService themeService: IThemeService,
		@IContextViewService contextViewService: IContextViewService,
		@IHoverService hoverService: IHoverService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(container, themeService, contextViewService, hoverService, configurationService);
		this.domNode.classList.add('setting-list-reorderable');

		// Alt+Up/Down moves the selected row, like moving lines in the editor.
		this._register(DOM.addStandardDisposableListener(this.domNode, 'keydown', (e: StandardKeyboardEvent) => {
			const delta = e.equals(KeyMod.Alt | KeyCode.UpArrow) ? -1 : e.equals(KeyMod.Alt | KeyCode.DownArrow) ? 1 : 0;
			const idx = this.model.getSelected();
			if (delta && idx !== null) {
				this.moveItem(idx, idx + delta);
				e.preventDefault();
				e.stopPropagation();
			}
		}));

		// Handle drags on the whole list, gaps between rows included: the Settings tree reads our rows'
		// data-index as its own, and the editor area would show a copy cursor.
		this._register(DOM.addDisposableListener(this.domNode, DOM.EventType.DRAG_OVER, e => {
			e.stopPropagation();
			if (this.dragSourceIndex !== undefined) {
				e.preventDefault();
				if (e.dataTransfer) {
					e.dataTransfer.dropEffect = 'move';
				}
			}
		}));
		this._register(DOM.addDisposableListener(this.domNode, DOM.EventType.DRAG_LEAVE, e => e.stopPropagation()));
		this._register(DOM.addDisposableListener(this.domNode, DOM.EventType.DROP, e => {
			e.stopPropagation();
			e.preventDefault();
		}));
	}

	override setValue(listData: IReorderListItem[]): void {
		// Keep the selection on the same language when the order changes underneath it, as after Reset Setting.
		const selected = this.model.getSelected();
		const selectedValue = selected === null ? undefined : this.model.items[selected]?.value.data;
		const idx = listData.findIndex(item => item.value.data === selectedValue);
		this.model.select(idx === -1 ? null : idx);
		super.setValue(listData, { showAddButton: false });
	}

	/** Reorders locally before firing, so a second move before the setting re-renders uses fresh indexes. */
	private moveItem(sourceIndex: number, targetIndex: number): void {
		const items: IReorderListItem[] = this.model.items.map(({ value, label }) => ({ value, label }));
		// A drag can outlive a re-render that shortened the list.
		if (sourceIndex < 0 || sourceIndex >= items.length || targetIndex < 0 || targetIndex >= items.length || sourceIndex === targetIndex) {
			return;
		}
		const [moved] = items.splice(sourceIndex, 1);
		items.splice(targetIndex, 0, moved);
		this.model.setValue(items);
		this.model.select(targetIndex);
		this._onDidChangeList.fire({ type: 'move', originalItem: moved, newItem: moved, sourceIndex, targetIndex });
		this.renderList();
	}

	protected override renderList(): void {
		const focused = DOM.isAncestorOfActiveElement(this.domNode);
		super.renderList();
		// Refocus now rather than on the base class's timeout: the settings tree
		// re-renders the list twice after a save, and the second cancels the timeout.
		const selected = [...this.domNode.children].find(row => row.classList.contains('selected'));
		if (focused && this.domNode.isConnected && DOM.isHTMLElement(selected)) {
			selected.focus();
		}
	}

	protected override getActionsForItem(_item: IReorderListItem, idx: number): IAction[] {
		const count = this.model.items.length;
		if (count < 2) {
			return [];
		}
		return [
			{
				class: ThemeIcon.asClassName(Codicon.arrowUp),
				enabled: idx > 0,
				id: 'workbench.action.moveListItemUp',
				tooltip: localize('positron.moveListItemUp', "Move Up"),
				run: () => this.moveItem(idx, idx - 1)
			},
			{
				class: ThemeIcon.asClassName(Codicon.arrowDown),
				enabled: idx < count - 1,
				id: 'workbench.action.moveListItemDown',
				tooltip: localize('positron.moveListItemDown', "Move Down"),
				run: () => this.moveItem(idx, idx + 1)
			}
		] as IAction[];
	}

	// Rows can't be edited; this also covers double-click.
	protected override editSetting(_idx: number): void { }

	protected override renderItem(item: IReorderListItem, idx: number) {
		const group = super.renderItem(item, idx);
		group.rowElement.prepend($('.setting-list-drag-handle' + ThemeIcon.asCSSSelector(Codicon.gripper)));
		group.keyElement.textContent = item.label;

		// The base list cancels pointerdown, which also cancels the native drag. Select here instead.
		this.listDisposables.add(DOM.addDisposableListener(group.rowElement, DOM.EventType.POINTER_DOWN, e => {
			if (!DOM.findParentWithClass(e.target as HTMLElement, 'monaco-action-bar')) {
				e.stopPropagation();
				this.selectRowElement(group.rowElement, idx);
			}
		}));
		return group;
	}

	private selectRowElement(rowElement: HTMLElement, idx: number): void {
		this.model.select(idx);
		for (const row of this.domNode.children) {
			row.classList.toggle('selected', row === rowElement);
			row.setAttribute('tabindex', row === rowElement ? '0' : '-1');
		}
		rowElement.focus();
	}

	clearSelection(): void {
		this.model.select(null);
	}

	protected override addDragAndDrop(rowElement: HTMLElement, item: IReorderListItem, idx: number): void {
		rowElement.draggable = true;
		rowElement.classList.add('draggable');
		let counter = 0;
		this.listDisposables.add(DOM.addDisposableListener(rowElement, DOM.EventType.DRAG_START, e => {
			this.dragSourceIndex = idx;
			applyDragImage(e, rowElement, item.label);
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'move';
			}
		}));
		this.listDisposables.add(DOM.addDisposableListener(rowElement, DOM.EventType.DRAG_ENTER, () => {
			counter++;
			rowElement.classList.add('drag-hover');
		}));
		this.listDisposables.add(DOM.addDisposableListener(rowElement, DOM.EventType.DRAG_LEAVE, () => {
			if (!--counter) {
				rowElement.classList.remove('drag-hover');
			}
		}));
		this.listDisposables.add(DOM.addDisposableListener(rowElement, DOM.EventType.DROP, () => {
			const sourceIndex = this.dragSourceIndex;
			if (sourceIndex === undefined) {
				return;
			}
			// The re-render drops the dragged row, so its dragend never clears this.
			this.dragSourceIndex = undefined;
			this.moveItem(sourceIndex, idx);
		}));
		this.listDisposables.add(DOM.addDisposableListener(rowElement, DOM.EventType.DRAG_END, () => {
			counter = 0;
			rowElement.classList.remove('drag-hover');
			this.dragSourceIndex = undefined;
		}));
	}

	// Name the label, not the saved value. No hover: it only repeats the row text and covers the buttons.
	protected override addTooltipsToRow(rowElementGroup: { rowElement: HTMLElement }, item: IReorderListItem): void {
		rowElementGroup.rowElement.setAttribute('aria-label', localize('positron.reorderListItemLabel', "List item `{0}`", item.label));
	}
}
