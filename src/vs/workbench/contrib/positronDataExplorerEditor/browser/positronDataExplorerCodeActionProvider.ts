/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { HierarchicalKind } from '../../../../base/common/hierarchicalKind.js';
import { Range } from '../../../../editor/common/core/range.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { CodeActionContext, CodeActionList, CodeActionProvider } from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { CodeActionKind } from '../../../../editor/contrib/codeAction/common/types.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronVariablesService } from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IViewDataFrameByVariableArgs, PositronDataExplorerCommandId } from './positronDataExplorerActions.js';
import { resolveDataFrameAtPosition } from './positronDataExplorerResolveDataFrame.js';

/**
 * The languages for which the "Open in Data Explorer" code action is offered.
 * Quarto is included so the action works inside R/Python chunks of a .qmd file;
 * the resolver keys off the embedded language at the cursor. Notebook cells are
 * covered by the 'r'/'python' selectors, since a cell editor's model language
 * is the cell's language.
 */
const CODE_ACTION_LANGUAGES = ['r', 'python', 'quarto'];

/**
 * Offers an "Open in Data Explorer" code action (lightbulb / Cmd+.) when the
 * symbol at the cursor names a viewable data frame in the editor's runtime
 * session.
 *
 * The action is a thin wrapper over the same resolution flow as the "View Data
 * Frame at Cursor" command: it resolves the symbol to a variable and, on
 * success, emits an action whose command opens that variable. Resolution runs
 * with `wait: false` and `openVariablesViewIfNeeded: false` so feeding the
 * lightbulb is instant and free of side effects -- if the variable isn't
 * already known, no action is offered.
 */
export class PositronDataExplorerCodeActionProvider implements CodeActionProvider {

	readonly providedCodeActionKinds = [CodeActionKind.Refactor.value];

	constructor(
		@ILanguageService private readonly _languageService: ILanguageService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IPositronVariablesService private readonly _variablesService: IPositronVariablesService,
		@IViewsService private readonly _viewsService: IViewsService,
	) { }

	async provideCodeActions(
		model: ITextModel,
		range: Range | Selection,
		context: CodeActionContext,
		_token: CancellationToken,
	): Promise<CodeActionList | undefined> {
		// Only do work when a refactor-kind action could actually be surfaced.
		// This skips unrelated requests such as source.fixAll on save.
		if (context.only && !CodeActionKind.Refactor.intersects(new HierarchicalKind(context.only))) {
			return undefined;
		}

		const resolution = await resolveDataFrameAtPosition(
			model,
			range.getStartPosition(),
			{
				languageService: this._languageService,
				runtimeSessionService: this._runtimeSessionService,
				variablesService: this._variablesService,
				viewsService: this._viewsService,
			},
			{ wait: false, openVariablesViewIfNeeded: false },
		);
		if (resolution.kind !== 'ok') {
			return undefined;
		}

		const args: IViewDataFrameByVariableArgs = {
			sessionId: resolution.sessionId,
			variableId: resolution.item.id,
		};
		return {
			actions: [
				{
					title: localize(
						'positron.dataExplorer.openInDataExplorer',
						"Open '{0}' in Data Explorer",
						resolution.item.displayName,
					),
					kind: CodeActionKind.Refactor.value,
					command: {
						id: PositronDataExplorerCommandId.ViewDataFrameByVariableAction,
						title: localize(
							'positron.dataExplorer.openInDataExplorer.command',
							"Open in Data Explorer",
						),
						arguments: [args],
					},
				},
			],
			dispose: () => { },
		};
	}
}

/**
 * Registers the {@link PositronDataExplorerCodeActionProvider} for the runtime
 * languages it supports.
 */
export class PositronDataExplorerCodeActionContribution extends Disposable {
	static readonly ID = 'workbench.contrib.positronDataExplorerCodeActions';

	constructor(
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._register(languageFeaturesService.codeActionProvider.register(
			CODE_ACTION_LANGUAGES,
			instantiationService.createInstance(PositronDataExplorerCodeActionProvider),
		));
	}
}
