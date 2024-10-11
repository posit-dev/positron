/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';

import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ActionBarSearch } from 'vs/platform/positronActionBar/browser/components/actionBarSearch';

import 'vs/css!./actionBar';
import { IPositronConnectionEntry } from 'vs/workbench/services/positronConnections/browser/positronConnectionsCache';

const kPaddingLeft = 8;
const kPaddingRight = 8;
export const kHeight = 32;

interface ActionBarProps {
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly hoverService: IHoverService;
	readonly keybindingService: IKeybindingService;
}

interface ConnectionActionBarProps extends ActionBarProps {
	selectedEntry: IPositronConnectionEntry | undefined;
	clearAllHandler: () => void;
}

export const ActionBar = (props: React.PropsWithChildren<ConnectionActionBarProps>) => {

	// We only enable the disconnect button if:
	// 1. there's some connection selected
	// 2. it's the root of a connection (level == 0).
	// 3. the connection is active.
	const disconnectDisabled = (props.selectedEntry === undefined) ||
		(props.selectedEntry.level !== 0) ||
		(!props.selectedEntry.active);

	// We only enable the connect button if:
	// 1. there's some connection selected
	// 2. it's the root of a connection (level == 0).
	// 3. the connection is not active.
	// 4. it implements a 'connect' method.
	const connectDisabled = (props.selectedEntry === undefined) ||
		(props.selectedEntry.level !== 0) ||
		(props.selectedEntry.active) ||
		(props.selectedEntry.connect === undefined);

	return (
		<div style={{ height: kHeight }}>
			<PositronActionBarContextProvider {...props}>
				<PositronActionBar
					size='small'
					borderTop={true}
					borderBottom={true}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
				>
					<ActionBarRegion location='left'>
						<ActionBarButton
							align='left'
							// TODO: should have a connect-icon
							iconId='debug-disconnect'
							tooltip={() => 'Connect'}
							disabled={connectDisabled}
							onPressed={() => props.selectedEntry?.connect?.()}
						/>
						<ActionBarSeparator />
						<ActionBarButton
							align='left'
							iconId='debug-disconnect'
							text='Disconnect'
							disabled={disconnectDisabled}
							onPressed={() => props.selectedEntry?.disconnect?.()}
						/>
						<ActionBarSeparator />
						<ActionBarButton
							align='left'
							iconId='refresh'
							onPressed={() => props.selectedEntry?.refresh?.()}
							disabled={props.selectedEntry === undefined || props.selectedEntry.refresh === undefined || !props.selectedEntry.active}
						/>
						<ActionBarSeparator />
						<ActionBarButton
							align='left'
							iconId='clear-all'
							onPressed={() => props.clearAllHandler()}
						/>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<div className='action-bar-disabled'>
							<ActionBarSearch placeholder='filter'></ActionBarSearch>
						</div>
					</ActionBarRegion>
				</PositronActionBar>
			</PositronActionBarContextProvider>
		</div>
	);
};
