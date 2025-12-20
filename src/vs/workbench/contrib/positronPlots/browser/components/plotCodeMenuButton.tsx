/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IAction } from '../../../../../base/common/actions.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { IPositronPlotClient } from '../../../../services/positronPlots/common/positronPlots.js';
import { CodeAttributionSource } from '../../../../services/positronConsole/common/positronConsoleCodeExecution.js';

// Localized strings.
const plotCodeActionsTooltip = localize('positronPlotCodeActions', "Plot code actions");
const copyCode = localize('positronPlots.copyCode', "Copy Code");
const revealInConsole = localize('positronPlots.revealInConsole', "Reveal Code in Console");
const runCodeAgain = localize('positronPlots.runCodeAgain', "Run Code Again");

/**
 * PlotCodeMenuButtonProps interface.
 */
interface PlotCodeMenuButtonProps {
	readonly plotClient: IPositronPlotClient;
}

/**
 * PlotCodeMenuButton component.
 * @param props A PlotCodeMenuButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const PlotCodeMenuButton = (props: PlotCodeMenuButtonProps) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Get metadata from the plot client.
	const plotCode = props.plotClient.metadata.code;
	const executionId = props.plotClient.metadata.execution_id;
	const sessionId = props.plotClient.metadata.session_id;
	const languageId = props.plotClient.metadata.language;

	// Builds the actions.
	const actions = (): IAction[] => {
		return [
			{
				id: 'copyCode',
				label: copyCode,
				tooltip: '',
				class: 'codicon codicon-copy',
				enabled: !!plotCode,
				run: () => {
					if (plotCode) {
						services.clipboardService.writeText(plotCode);
					}
				}
			},
			{
				id: 'revealInConsole',
				label: revealInConsole,
				tooltip: '',
				class: 'codicon codicon-go-to-file',
				enabled: !!executionId && !!sessionId,
				run: () => {
					if (executionId && sessionId) {
						services.positronConsoleService.revealExecution(sessionId, executionId);
					}
				}
			},
			{
				id: 'runCodeAgain',
				label: runCodeAgain,
				tooltip: '',
				class: 'codicon codicon-run',
				enabled: !!plotCode && !!sessionId,
				run: async () => {
					if (plotCode && sessionId && languageId) {
						await services.positronConsoleService.executeCode(
							languageId,
							sessionId,
							plotCode,
							{ source: CodeAttributionSource.Interactive },
							true
						);
					}
				}
			}
		];
	};

	return (
		<ActionBarMenuButton
			actions={actions}
			icon={ThemeIcon.fromId('code')}
			tooltip={plotCode ?? plotCodeActionsTooltip}
		/>
	);
};
