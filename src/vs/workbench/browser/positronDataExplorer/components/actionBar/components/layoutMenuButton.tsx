/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./layoutMenuButton';

// React.
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { IAction } from 'vs/base/common/actions';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronDataExplorerContext } from 'vs/workbench/browser/positronDataExplorer/positronDataExplorerContext';
import { PositronDataExplorerLayout } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';

/**
 * Localized strings.
 */
const layoutButtonTitle = localize('positron.layoutButtonTitle', "Layout");
const layoutButtonDescription = localize('positron.layoutButtonDescription', "Change layout");
const summaryOnLeft = localize('positron.summaryOnLeft', "Summary on Left");
const summaryOnRight = localize('positron.summaryOnRight', "Summary on Right");

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

		// Summary on left.
		actions.push({
			id: 'SummaryOnLeft',
			label: summaryOnLeft,
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: layout === PositronDataExplorerLayout.SummaryOnLeft,
			run: () => {
				context.instance.layout = PositronDataExplorerLayout.SummaryOnLeft;
			}
		});

		// Summary on right.
		actions.push({
			id: 'SummaryOnRight',
			label: summaryOnRight,
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: layout === PositronDataExplorerLayout.SummaryOnRight,
			run: () => {
				context.instance.layout = PositronDataExplorerLayout.SummaryOnRight;
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
			// Summary on left.
			case PositronDataExplorerLayout.SummaryOnLeft:
				return 'positron-data-explorer-summary-on-left';

			// Summary on right.
			case PositronDataExplorerLayout.SummaryOnRight:
				return 'positron-data-explorer-summary-on-right';

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
