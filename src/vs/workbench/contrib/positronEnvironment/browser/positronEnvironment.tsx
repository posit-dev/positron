/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronEnvironment';
import * as React from 'react';
import { PropsWithChildren, useEffect, useMemo, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { generateUuid } from 'vs/base/common/uuid';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ListItem, PositronList } from 'vs/base/browser/ui/positronList/positronList';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarFilter } from 'vs/platform/positronActionBar/browser/components/actionBarFilter';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { PositronEnvironmentServices } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentState';
import { PositronEnvironmentContextProvider } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';
import { LanguageRuntimeSelectorMenuButton } from 'vs/workbench/contrib/positronEnvironment/browser/components/languageRuntimeSelectorMenuButton';
import { TestComponent } from 'vs/workbench/contrib/positronEnvironment/browser/components/testComponent';

// Constants.
const kSecondaryActionBarGap = 4;
const kPaddingLeft = 14;
const kPaddingRight = 8;
const kFilterTimeout = 800;

/**
 * TestListItem class.
 */
class TestListItem implements ListItem {
	//#region Private Properties

	private readonly _id = generateUuid();
	private readonly _height;

	//#endregion Private Properties

	//#region Public Properties

	get id() {
		return this._id;
	}

	get height() {
		return this._height;
	}

	get element() {
		return (
			<TestComponent />
		);
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param _entryNumber The entry number of the
	 */
	constructor(entryNumber: number) {
		// As a test of variable height entries, even entries are 50px in height and odd entries are 25px in height.
		this._height = entryNumber % 2 ? 50 : 25;
	}

	//#endregion Constructor
}

/**
 * PositronEnvironmentProps interface.
 */
export interface PositronEnvironmentProps extends PositronEnvironmentServices {
	// Services.
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly keybindingService: IKeybindingService;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * PositronEnvironment component.
 * @param props A PositronEnvironmentProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronEnvironment = (props: PropsWithChildren<PositronEnvironmentProps>) => {
	// Hooks.
	const [height, setHeight] = useState(props.reactComponentContainer.height);
	const [filterText, setFilterText] = useState('');
	const [listItems, setListItems] = useState<ListItem[]>([]);

	// Memoize the list items.
	useMemo(() => {
		// Generate the test list items.
		const testListItems: TestListItem[] = [];
		for (let i = 0; i < 250_000; i++) {
			testListItems.push(new TestListItem(i));
		}

		// Set the list items.
		setListItems(testListItems);
	}, []);

	// Add IReactComponentContainer event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSizeChanged event handler.
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			setHeight(size.height);
		}));

		// Add the onVisibilityChanged event handler.
		disposableStore.add(props.reactComponentContainer.onVisibilityChanged(visibility => {
			// TODO@softwarenerd - For the moment, doing nothing.
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Find text change handler.
	useEffect(() => {
		if (filterText === '') {
			return setFilterText('');
		} else {
			// Start the filter timeout.
			const filterTimeout = setTimeout(() => {
				console.log('Filter text changed - do filtering');
			}, kFilterTimeout);

			// Clear the find timeout.
			return () => clearTimeout(filterTimeout);
		}
	}, [filterText]);

	// Load workspace handler.
	const loadWorkspaceHandler = () => {
		console.log('loadWorkspaceHandler called');
	};

	// Save workspace handler.
	const saveWorkspaceHandler = () => {
		console.log('loadWorkspaceHandler called');
	};

	// Render.
	return (
		<PositronEnvironmentContextProvider {...props}>
			<div className='positron-environment'>
				<PositronActionBarContextProvider {...props}>
					<div className='positron-environment-action-bars'>
						<PositronActionBar size='small' paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
							<ActionBarRegion align='left'>
								<ActionBarButton iconId='positron-open' tooltip={localize('positronLoadWorkspace', "Load workspace")} onClick={() => loadWorkspaceHandler()} />
								<ActionBarButton iconId='positron-save' tooltip={localize('positronSaveWorkspace', "Save workspace as")} onClick={() => saveWorkspaceHandler()} />
								<ActionBarSeparator />
								<ActionBarButton iconId='positron-import-data' text='Import Dataset' dropDown={true} />
								<ActionBarSeparator />
								<ActionBarButton iconId='positron-clean' tooltip={localize('positronClearObjects', "Clear workspace objects")} />
								<ActionBarSeparator />
								<ActionBarButton iconId='positron-test' tooltip={localize('positronTestMode', "Enter test mode")} />
							</ActionBarRegion>
							<ActionBarRegion align='right'>
								<ActionBarButton align='right' iconId='positron-refresh' tooltip={localize('positronRefreshObjects', "Refresh workspace objects")} />
							</ActionBarRegion>
						</PositronActionBar>
						<PositronActionBar size='small' gap={kSecondaryActionBarGap} borderBottom={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
							<ActionBarRegion align='left'>
								<LanguageRuntimeSelectorMenuButton />
								<ActionBarSeparator />
								<ActionBarButton iconId='positron-environment' text='Global Environment' dropDown={true} tooltip={localize('positronSelectEnvironment', "Select environment")} />
							</ActionBarRegion>
							<ActionBarRegion align='right'>
								<ActionBarFilter
									width={150}
									initialFilterText={filterText}
									onFilterTextChanged={setFilterText} />
							</ActionBarRegion>
						</PositronActionBar>
					</div>
				</PositronActionBarContextProvider>
				<PositronList height={height - 64} listItems={listItems} />
			</div>
		</PositronEnvironmentContextProvider>
	);
};
