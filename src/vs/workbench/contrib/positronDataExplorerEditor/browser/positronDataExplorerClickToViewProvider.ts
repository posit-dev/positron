/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IPosition } from '../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IClickToViewProvider, registerClickToViewProvider } from '../../../../editor/contrib/gotoSymbol/browser/link/clickToViewProvider.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronVariablesService } from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IViewDataFrameByVariableArgs, PositronDataExplorerCommandId } from './positronDataExplorerActions.js';
import { resolveDataFrameAtPosition } from './positronDataExplorerResolveDataFrame.js';

/**
 * The RStudio keybindings setting, declared in
 * positronKeybindings.contribution.ts. Referenced by string here because that
 * contribution does not export a constant for it; keep in sync if it moves.
 */
const RSTUDIO_KEYBINDINGS_SETTING = 'workbench.keybindings.rstudioKeybindings';

/**
 * Redirects a modifier+click (Cmd/Ctrl+Click) on a data frame identifier to the
 * Data Explorer, before go-to-definition runs.
 *
 * This is the RStudio "Ctrl+Click to view" gesture. It is gated on the RStudio
 * keymap setting so it only overrides go-to-definition for the cohort that
 * expects it; default / VS Code users keep plain go-to-definition on
 * Cmd+Click. The gesture itself is delivered by the editor's go-to-definition
 * contribution (a mouse modifier gesture, which the keybindings registry cannot
 * bind), so this provider does the gating live via the configuration service.
 *
 * Resolution runs with `wait: false` and `openVariablesViewIfNeeded: false` so
 * the click is instant and free of side effects, and go-to-definition (which
 * awaits this provider) is never delayed on a cold Variables pane: if the symbol
 * is not an already-known viewable data frame, the click falls through to
 * go-to-definition.
 */
export class PositronDataExplorerClickToViewContribution extends Disposable implements IClickToViewProvider {

	static readonly ID = 'workbench.contrib.positronDataExplorerClickToView';

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IPositronVariablesService private readonly _variablesService: IPositronVariablesService,
		@IViewsService private readonly _viewsService: IViewsService,
	) {
		super();
		this._register(registerClickToViewProvider(this));
	}

	async handleClick(model: ITextModel, position: IPosition): Promise<boolean> {
		try {
			// Gated on the RStudio keymap. Read live: the setting can change
			// without a click contribution restart. Compare against `true` so an
			// unset (undefined) value can't slip through.
			if (this._configurationService.getValue<boolean>(RSTUDIO_KEYBINDINGS_SETTING) !== true) {
				return false;
			}

			const resolution = await resolveDataFrameAtPosition(
				model,
				position,
				{
					languageService: this._languageService,
					runtimeSessionService: this._runtimeSessionService,
					variablesService: this._variablesService,
					viewsService: this._viewsService,
				},
				{ wait: false, openVariablesViewIfNeeded: false },
			);
			if (resolution.kind !== 'ok') {
				return false;
			}

			const args: IViewDataFrameByVariableArgs = {
				sessionId: resolution.sessionId,
				variableId: resolution.item.id,
			};
			await this._commandService.executeCommand(
				PositronDataExplorerCommandId.ViewDataFrameByVariableAction,
				args,
			);
			return true;
		} catch {
			// Never let a resolution or open error break go-to-definition; treat
			// it as unhandled so the click falls through.
			return false;
		}
	}
}
