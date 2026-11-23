/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';

/**
 * A layout built for one kind of work, such as notebooks or chatting with an
 * agent. The title bar's layout picker lists these.
 */
export interface TaskLayout {
	/** The layout's command id, which is also its id. */
	readonly id: string;
	/** The short name the picker shows, such as "Notebook". */
	readonly name: string;
	/** The icon the picker shows. */
	readonly codicon?: string;
	/** Where the layout sits in the picker. Lower comes first. */
	readonly order: number;
	/** When the layout can be used. */
	readonly precondition: ContextKeyExpression;
}

const taskLayouts: TaskLayout[] = [];

/**
 * Adds a layout to the title bar's layout picker.
 * @param layout The layout to add.
 */
export function registerTaskLayout(layout: TaskLayout): void {
	taskLayouts.push(layout);
	taskLayouts.sort((a, b) => a.order - b.order);
}

/**
 * The layouts the title bar's layout picker lists, in order.
 * @returns The task layouts, whether or not they can be used right now.
 */
export function getTaskLayouts(): readonly TaskLayout[] {
	return taskLayouts;
}
