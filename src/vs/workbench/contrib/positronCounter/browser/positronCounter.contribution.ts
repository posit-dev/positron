/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { COUNTER_INITIAL_VALUE_KEY, ICounterService } from '../common/counter.js';
import { DecrementCounterAction, IncrementCounterAction, OpenCounterEditorAction, ResetCounterAction, UndoCounterAction } from './counterActions.js';
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

// The commands.
registerAction2(OpenCounterEditorAction);
registerAction2(IncrementCounterAction);
registerAction2(DecrementCounterAction);
registerAction2(ResetCounterAction);
registerAction2(UndoCounterAction);

// The status bar item: a non-React reader of the store.
registerWorkbenchContribution2(CounterStatusBarContribution.ID, CounterStatusBarContribution, WorkbenchPhase.AfterRestored);
