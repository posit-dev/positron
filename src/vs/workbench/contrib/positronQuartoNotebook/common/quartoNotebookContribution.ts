/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { QMD_VIEW_TYPE } from './quartoNotebookConstants.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { QuartoNotebookSerializer } from './quartoNotebookSerializer.js';

/** Mock extension identifier for notebook serializer registration */
const QUARTO_NOTEBOOK_EXTENSION_ID = new ExtensionIdentifier('positron.quarto-notebook');

/**
 * Workbench contribution that registers the Quarto notebook type and serializer.
 */
class QuartoNotebookContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.quartoNotebook';

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@INotebookService private readonly _notebookService: INotebookService,
	) {
		super();

		// Register the notebook type (file pattern association)
		this._register(this._notebookService.registerContributedNotebookType(
			QMD_VIEW_TYPE,
			{
				extension: QUARTO_NOTEBOOK_EXTENSION_ID,
				displayName: localize('quartoNotebook.displayName', 'Quarto Notebook'),
				providerDisplayName: localize('quartoNotebook.providerDisplayName', 'Positron'),
				filenamePattern: ['*.qmd'],
				priority: RegisteredEditorPriority.default,
			}
		));

		// Register the serializer
		const notebookSerializer = this._instantiationService.createInstance(QuartoNotebookSerializer);
		this._register(this._notebookService.registerNotebookSerializer(
			QMD_VIEW_TYPE,
			{ id: QUARTO_NOTEBOOK_EXTENSION_ID, location: undefined },
			notebookSerializer
		));
	}
}

registerWorkbenchContribution2(
	QuartoNotebookContribution.ID,
	QuartoNotebookContribution,
	WorkbenchPhase.AfterRestored
);
