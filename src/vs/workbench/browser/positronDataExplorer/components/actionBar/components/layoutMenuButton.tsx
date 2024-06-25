/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./layoutMenuButton';

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from 'vs/nls';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { IAction, Separator } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronDataExplorerContext } from 'vs/workbench/browser/positronDataExplorer/positronDataExplorerContext';
import { PositronDataExplorerLayout } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';
import { DisposableStore } from 'vs/base/common/lifecycle';

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
	const context = usePositronDataExplorerContext();

	// State hooks.
	const [currentLayout, setCurrentLayout] = useState(context.instance.layout);

	// Main useEffect. Listen for layout changes and update the current layout
	// state.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeLayout event handler.
		disposableStore.add(context.instance.onDidChangeLayout(layout => {
			setCurrentLayout(layout);
		}));

		return () => disposableStore.dispose();
	}, [context.instance]);

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
			checked: layout === PositronDataExplorerLayout.ColumnsLeft,
			run: () => {
				context.instance.layout = PositronDataExplorerLayout.ColumnsLeft;
			}
		});

		// Columns on right.
		actions.push({
			id: 'ColumnsRight',
			label: columnsOnRight,
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: layout === PositronDataExplorerLayout.ColumnsRight,
			run: () => {
				context.instance.layout = PositronDataExplorerLayout.ColumnsRight;
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
			checked: layout === PositronDataExplorerLayout.ColumnsHidden,
			run: () => {
				context.instance.layout = PositronDataExplorerLayout.ColumnsHidden;
			}
		});

		// Done. Return the actions.
		return actions;
	};

	/**
	 * Selects the icon ID for the layout.
	 * @returns The icon ID for the layout.
	 */
	const selectIconId = (layout: PositronDataExplorerLayout) => {
		switch (layout) {
			// Columns left.
			case PositronDataExplorerLayout.ColumnsLeft:
				return 'positron-data-explorer-columns-left';

			// Columns right.
			case PositronDataExplorerLayout.ColumnsRight:
				return 'positron-data-explorer-columns-right';

			// Columns hidden.
			case PositronDataExplorerLayout.ColumnsHidden:
				return 'positron-data-explorer-columns-hidden';

			// Can't happen.
			default:
				return undefined;
		}
	};

	// Render.
	return (
		<ActionBarMenuButton
			iconId={selectIconId(currentLayout)}
			text={layoutButtonTitle}
			tooltip={layoutButtonDescription}
			ariaLabel={layoutButtonDescription}
			actions={actions}
		/>
	);
};
