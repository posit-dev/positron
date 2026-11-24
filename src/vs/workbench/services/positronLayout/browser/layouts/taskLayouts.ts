/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';

/**
 * Which group a layout sits in, in the title bar's layout picker.
 *
 * - `task`: built for one kind of work, such as notebooks. In the simplified
 *   layout it hides the views that work does not need, and gathers the panel
 *   tools into the Tools container.
 * - `layout`: a general layout that shows every view where it normally lives.
 */
export type TaskLayoutGroup = 'task' | 'layout';

/**
 * A layout the title bar's layout picker lists.
 */
export interface TaskLayout {
	/** The layout's command id, which is also its id. */
	readonly id: string;
	/** The short name the picker shows, such as "Notebook". */
	readonly name: string;
	/** A few words under the name saying what the layout is for. */
	readonly description?: string;
	/** The icon the picker shows. */
	readonly codicon?: string;
	/** The group the picker shows the layout in. */
	readonly group: TaskLayoutGroup;
	/** Where the layout sits in its group. Lower comes first. */
	readonly order: number;
	/**
	 * For a task layout, the view containers it hides on top of the ones every
	 * task layout hides.
	 */
	readonly hiddenViewContainers: readonly string[];
	/** When the layout can be used. */
	readonly precondition: ContextKeyExpression;
}

const GROUP_ORDER: Record<TaskLayoutGroup, number> = { task: 0, layout: 1 };

const taskLayouts: TaskLayout[] = [];

/**
 * Adds a layout to the title bar's layout picker.
 * @param layout The layout to add.
 */
export function registerTaskLayout(layout: TaskLayout): void {
	taskLayouts.push(layout);
	taskLayouts.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.order - b.order);
}

/**
 * The layouts the title bar's layout picker lists: the task layouts first, then
 * the general ones, each in order.
 * @returns The layouts, whether or not they can be used right now.
 */
export function getTaskLayouts(): readonly TaskLayout[] {
	return taskLayouts;
}

/**
 * Looks up a layout the picker lists.
 * @param id The layout's command id.
 * @returns The layout, or undefined when the picker does not list it.
 */
export function getTaskLayout(id: string): TaskLayout | undefined {
	return taskLayouts.find(layout => layout.id === id);
}
