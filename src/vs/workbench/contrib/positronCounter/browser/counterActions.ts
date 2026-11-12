/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { COUNTER_OPEN_COMMAND_ID, ICounterService } from '../common/counter.js';
import { CounterEditorInput } from './counterEditorInput.js';

// The Counter commands. Developer category, palette only, no keybindings.

/** Opens the Counter editor, or reveals it if it is already open in any group. */
export class OpenCounterEditorAction extends Action2 {
	constructor() {
		super({
			id: COUNTER_OPEN_COMMAND_ID,
			title: localize2('positron.counter.open', "Open Counter Editor"),
			category: Categories.Developer,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		await editorService.openEditor(instantiationService.createInstance(CounterEditorInput), { pinned: true, revealIfOpened: true });
	}
}

/** Increments the counter by 1. */
export class IncrementCounterAction extends Action2 {
	constructor() {
		super({
			id: 'positron.counter.increment',
			title: localize2('positron.counter.incrementCommand', "Increment Counter"),
			category: Categories.Developer,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(ICounterService).increment();
	}
}

/** Decrements the counter by 1. */
export class DecrementCounterAction extends Action2 {
	constructor() {
		super({
			id: 'positron.counter.decrement',
			title: localize2('positron.counter.decrementCommand', "Decrement Counter"),
			category: Categories.Developer,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(ICounterService).decrement();
	}
}

/** Resets the counter to the configured initial value. */
export class ResetCounterAction extends Action2 {
	constructor() {
		super({
			id: 'positron.counter.reset',
			title: localize2('positron.counter.resetCommand', "Reset Counter"),
			category: Categories.Developer,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(ICounterService).reset();
	}
}

/** Undoes the most recent counter change. */
export class UndoCounterAction extends Action2 {
	constructor() {
		super({
			id: 'positron.counter.undo',
			title: localize2('positron.counter.undoCommand', "Undo Counter Change"),
			category: Categories.Developer,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(ICounterService).undo();
	}
}
