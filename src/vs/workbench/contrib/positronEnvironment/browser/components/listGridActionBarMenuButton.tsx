/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./listGridActionBarMenuButton';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IAction } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { PositronEnvironmentViewMode, usePositronEnvironmentState } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentState';

/**
 * ListGridActionBarMenuButton component.
 * @returns The component.
 */
export const ListGridActionBarMenuButton = () => {
	// Hooks.
	const positronEnvironmentContext = usePositronEnvironmentState();

	// Builds the actions.
	const actions = () => {
		const actions: IAction[] = [];
		actions.push({
			id: 'a697ead4-9afb-4a92-851c-3cdd1eb15dea',
			label: 'List',
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => {
				positronEnvironmentContext.setEnvironmentViewMode(PositronEnvironmentViewMode.List);
			}
		});
		actions.push({
			id: 'a16bb545-c775-4ff1-bb68-2e5b7ba67efd',
			label: 'Grid',
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => {
				positronEnvironmentContext.setEnvironmentViewMode(PositronEnvironmentViewMode.Grid);
			}
		});
		return actions;
	};

	// Render.
	return (
		<ActionBarMenuButton
			iconId={positronEnvironmentContext.environmentViewMode === PositronEnvironmentViewMode.List ? 'positron-list' : 'positron-grid'}
			text={positronEnvironmentContext.environmentViewMode === PositronEnvironmentViewMode.List ? localize('positronListViewMode', "List") : localize('positronGridViewMode', "Grid")}
			actions={actions}
		/>
	);
};
