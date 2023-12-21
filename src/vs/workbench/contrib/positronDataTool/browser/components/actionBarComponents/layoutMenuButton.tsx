/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./layoutMenuButton';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IAction, Separator } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronDataToolContext } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolContext';
import { PositronDataToolLayout } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolService';

/**
 * Localized strings.
 */
const layoutButtonTitle = localize('positron.layoutButtonTitle', "Layout");
const layoutButtonDescription = localize('positron.layoutButtonDescription', "Change layout");
const columnsOnLeft = localize('positron.columnsOnLeft', "Columns on Left");
const columnsOnRight = localize('positron.columnsOnRight', "Columns on Right");
const columnsHidden = localize('positron.columnsHidden', "Columns Hidden");

/**
 * LayoutMenuButton component.
 * @returns The rendered component.
 */
export const LayoutMenuButton = () => {
	// Context hooks.
	const context = usePositronDataToolContext();

	// Builds the actions.
	const actions = () => {
		// Get the current layout.
		const layout = context.instance.layout;

		// Build the actions.
		const actions: IAction[] = [];

		// Columns on left.
		actions.push({
			id: 'ColumnsLeft',
			label: columnsOnLeft,
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: layout === PositronDataToolLayout.ColumnsLeft,
			run: () => {
				context.instance.layout = PositronDataToolLayout.ColumnsLeft;
			}
		});

		// Columns on right.
		actions.push({
			id: 'ColumnsRight',
			label: columnsOnRight,
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: layout === PositronDataToolLayout.ColumnsRight,
			run: () => {
				context.instance.layout = PositronDataToolLayout.ColumnsRight;
			}
		});

		// Separator.
		actions.push(new Separator());

		// Columns on right.
		actions.push({
			id: 'ColumnsHidden',
			label: columnsHidden,
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: layout === PositronDataToolLayout.ColumnsHidden,
			run: () => {
				context.instance.layout = PositronDataToolLayout.ColumnsHidden;
			}
		});

		// Done. Return the actions.
		return actions;
	};

	/**
	 * Selects the icon ID for the layout.
	 * @returns The icon ID for the layout.
	 */
	const selectIconId = () => {
		switch (context.instance.layout) {
			// Columns left.
			case PositronDataToolLayout.ColumnsLeft:
				return 'positron-data-tool-columns-left';

			// Columns right.
			case PositronDataToolLayout.ColumnsRight:
				return 'positron-data-tool-columns-right';

			// Columns hidden.
			case PositronDataToolLayout.ColumnsHidden:
				return 'positron-data-tool-columns-hidden';

			// Can't happen.
			default:
				return undefined;
		}
	};

	// Render.
	return (
		<ActionBarMenuButton
			iconId={selectIconId()}
			text={layoutButtonTitle}
			tooltip={layoutButtonDescription}
			ariaLabel={layoutButtonDescription}
			actions={actions}
		/>
	);
};
