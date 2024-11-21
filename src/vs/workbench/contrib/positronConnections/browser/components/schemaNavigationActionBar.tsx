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

import 'vs/css!./actionBar';
import { localize } from 'vs/nls';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';

const ACTION_BAR_PADDING_LEFT = 8;
const ACTION_BAR_PADDING_RIGHT = 8;
export const ACTION_BAR_HEIGHT = 32;

interface ActionBarProps {
	readonly accessibilityService: IAccessibilityService;
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly hoverService: IHoverService;
	readonly keybindingService: IKeybindingService;
}

interface ConnectionActionBarProps extends ActionBarProps {
	onDisconnect: () => void;
	onBack: () => void;
	onRefresh: () => void;
}

export const ActionBar = (props: React.PropsWithChildren<ConnectionActionBarProps>) => {

	return (
		<div style={{ height: ACTION_BAR_HEIGHT }}>
			<PositronActionBarContextProvider {...props}>
				<PositronActionBar
					size='small'
					borderTop={true}
					borderBottom={true}
					paddingLeft={ACTION_BAR_PADDING_LEFT}
					paddingRight={ACTION_BAR_PADDING_RIGHT}
				>
					<ActionBarRegion location='left'>
						<ActionBarButton
							align='left'
							iconId='arrow-left'
							tooltip={(() => localize('positron.schemaNavigationActionBar.back', 'Back'))()}
							onPressed={() => props.onBack()}
						/>
						<ActionBarSeparator />
						<ActionBarButton
							align='left'
							iconId='positron-disconnect-connection'
							text={(() => localize('positron.schemaNavigationActionBar.disconnect', 'Disconnect'))()}
							onPressed={() => props.onDisconnect()}
						/>
						<ActionBarSeparator />
						<ActionBarButton
							align='left'
							iconId='refresh'
							text={(() => localize('positron.schemaNavigationActionBar.refresh', 'Refresh'))()}
							onPressed={() => props.onRefresh()}
						/>
					</ActionBarRegion>
				</PositronActionBar>
			</PositronActionBarContextProvider>
		</div>
	);
};
