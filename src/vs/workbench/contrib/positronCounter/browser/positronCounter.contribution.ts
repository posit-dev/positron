/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { COUNTER_INITIAL_VALUE_KEY, COUNTER_OPEN_COMMAND_ID, ICounterService } from '../common/counter.js';
import { CounterEditor } from './counterEditor.js';
import { CounterEditorInput } from './counterEditorInput.js';
import { CounterService } from './counterService.js';
import { CounterStatusBarContribution } from './counterStatusBar.js';

// The service.
registerSingleton(ICounterService, CounterService, InstantiationType.Delayed);

// The setting.
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'counter',
	type: 'object',
	title: localize('positron.counter.configurationTitle', "Counter"),
	properties: {
		[COUNTER_INITIAL_VALUE_KEY]: {
			type: 'number',
			default: 0,
			description: localize('positron.counter.initialValue', "Initial value of the developer Counter demo, and the value Reset returns to."),
		},
	},
});

/** Restores the Counter editor across reloads. */
class CounterEditorSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}

	serialize(input: EditorInput): string | undefined {
		return input instanceof CounterEditorInput ? '{}' : undefined;
	}

	deserialize(instantiationService: IInstantiationService): EditorInput | undefined {
		return instantiationService.createInstance(CounterEditorInput);
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	CounterEditorInput.TypeID,
	CounterEditorSerializer
);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(CounterEditor, CounterEditorInput.EditorID, 'Counter'),
	[new SyncDescriptor(CounterEditorInput)]
);

// The commands. Developer category, palette only, no keybindings.

class OpenCounterEditorAction extends Action2 {
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
		await editorService.openEditor(instantiationService.createInstance(CounterEditorInput), { pinned: true });
	}
}

class IncrementCounterAction extends Action2 {
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

class DecrementCounterAction extends Action2 {
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

class ResetCounterAction extends Action2 {
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

class UndoCounterAction extends Action2 {
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

registerAction2(OpenCounterEditorAction);
registerAction2(IncrementCounterAction);
registerAction2(DecrementCounterAction);
registerAction2(ResetCounterAction);
registerAction2(UndoCounterAction);

// The status bar item: a non-React reader of the store.
registerWorkbenchContribution2(CounterStatusBarContribution.ID, CounterStatusBarContribution, WorkbenchPhase.AfterRestored);
