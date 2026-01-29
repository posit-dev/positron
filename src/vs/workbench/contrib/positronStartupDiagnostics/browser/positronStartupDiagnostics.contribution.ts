/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorExtensions, IEditorSerializer, IEditorFactoryRegistry } from '../../../common/editor.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { localize2 } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { PositronStartupDiagnosticsContrib, PositronStartupDiagnosticsInput } from './positronStartupDiagnosticsEditor.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';

// Register the contribution (lazy loading)
registerWorkbenchContribution2(
	PositronStartupDiagnosticsContrib.ID,
	PositronStartupDiagnosticsContrib,
	WorkbenchPhase.BlockRestore
);

// Register editor serializer
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	PositronStartupDiagnosticsInput.Id,
	class implements IEditorSerializer {
		canSerialize(): boolean {
			return true;
		}
		serialize(): string {
			return '';
		}
		deserialize(instantiationService: IInstantiationService): PositronStartupDiagnosticsInput {
			return instantiationService.createInstance(PositronStartupDiagnosticsInput);
		}
	}
);

// Register F1 command
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'positron.startupDiagnostics.show',
			title: localize2('positronStartupDiagnostics.title', 'Positron: Runtime Startup Diagnostics'),
			category: Categories.Developer,
			f1: true
		});
	}

	run(accessor: ServicesAccessor) {
		const editorService = accessor.get(IEditorService);
		const contrib = PositronStartupDiagnosticsContrib.get();
		return editorService.openEditor(contrib.getEditorInput(), { pinned: true });
	}
});
