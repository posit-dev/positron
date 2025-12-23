/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IAction } from '../../../../../base/common/actions.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { IPositronPlotClient } from '../../../../services/positronPlots/common/positronPlots.js';
import { CodeAttributionSource } from '../../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { IPositronPlotMetadata } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';

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

	// State to track metadata changes.
	const [metadata, setMetadata] = useState<IPositronPlotMetadata>(props.plotClient.metadata);

	// Subscribe to metadata updates.
	useEffect(() => {
		const disposable = props.plotClient.onDidUpdateMetadata?.(newMetadata => {
			setMetadata(newMetadata);
		});
		return () => disposable?.dispose();
	}, [props.plotClient]);

	// Get metadata from state.
	const plotCode = metadata.code;
	const executionId = metadata.execution_id;
	const sessionId = metadata.session_id;
	const languageId = metadata.language;

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
					services.clipboardService.writeText(plotCode);
					const trimmedCode = plotCode.substring(0, 20) + (plotCode.length > 20 ? '...' : '');
					services.notificationService.info(
						localize('positronPlots.copyCodeInfo', "Plot code copied to clipboard: {0}", trimmedCode)
					);
				}
			},
			{
				id: 'revealInConsole',
				label: revealInConsole,
				tooltip: '',
				class: 'codicon codicon-go-to-file',
				enabled: !!executionId && !!sessionId,
				run: () => {
					try {
						services.positronConsoleService.revealExecution(sessionId!, executionId!);
					} catch (error) {
						// It's very possible that the code that generated this
						// plot has been removed from the console (e.g. if the
						// console was cleared). In that case, just log a
						// warning and show a notification.
						if (error instanceof Error) {
							services.logService.warn(error.message);
						}
						services.notificationService.warn(
							localize('positronPlots.revealInConsoleError', "The code that generated this plot is no longer present in the console.")
						);
					}
				}
			},
			{
				id: 'runCodeAgain',
				label: runCodeAgain,
				tooltip: '',
				class: 'codicon codicon-run',
				enabled: !!plotCode && !!sessionId && !!languageId,
				run: async () => {
					await services.positronConsoleService.executeCode(
						languageId!,
						sessionId,
						plotCode,
						{ source: CodeAttributionSource.Interactive },
						true
					);
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
