/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { QMD_VIEW_TYPE } from './quartoNotebookConstants.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { QuartoNotebookSerializer } from './quartoNotebookSerializer.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/** Mock extension identifier for notebook serializer registration */
const QUARTO_NOTEBOOK_EXTENSION_ID = new ExtensionIdentifier('positron.quarto-notebook');

/**
 * Workbench contribution that registers the Quarto notebook type and serializer.
 */
class QuartoNotebookContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.quartoNotebook';

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@INotebookService private readonly _notebookService: INotebookService,
	) {
		super();

		this._logService.info('[QuartoNotebookContribution] Registering Quarto notebook contribution');

		// Register the .qmd notebook type if not already registered e.g. after a window reload
		const info = this._notebookService.getContributedNotebookType(QMD_VIEW_TYPE);
		if (!info) {
			this._register(this._notebookService.registerContributedNotebookType(
				QMD_VIEW_TYPE,
				{
					displayName: localize('quartoNotebook.displayName', 'Quarto Notebook'),
					providerDisplayName: localize('quartoNotebook.providerDisplayName', 'Positron'),
					filenamePattern: ['*.qmd'],
				}
			));
		}

		// Register the .qmd notebook serializer
		const notebookSerializer = this._instantiationService.createInstance(QuartoNotebookSerializer);
		this._register(this._notebookService.registerNotebookSerializer(
			QMD_VIEW_TYPE,
			{
				id: QUARTO_NOTEBOOK_EXTENSION_ID,
				// Location URI is added as a resource root in notebook output webviews,
				// which we don't currently need
				location: undefined
			},
			notebookSerializer
		));
	}
}

registerWorkbenchContribution2(
	QuartoNotebookContribution.ID,
	QuartoNotebookContribution,
	WorkbenchPhase.BlockRestore
);
