/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBar.css';

// React.
import React from 'react';

import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';

import { localize } from '../../../../../nls.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';

const ACTION_BAR_PADDING_LEFT = 8;
const ACTION_BAR_PADDING_RIGHT = 8;
export const ACTION_BAR_HEIGHT = 32;

interface ConnectionActionBarProps {
	onDisconnect: () => void;
	onBack: () => void;
	onRefresh: () => void;
}

export const ActionBar = (props: React.PropsWithChildren<ConnectionActionBarProps>) => {

	return (
		<div style={{ height: ACTION_BAR_HEIGHT }}>
			<PositronActionBarContextProvider {...props}>
				<PositronActionBar
					borderBottom={true}
					borderTop={true}
					paddingLeft={ACTION_BAR_PADDING_LEFT}
					paddingRight={ACTION_BAR_PADDING_RIGHT}
				>
					<ActionBarRegion location='left'>
						<ActionBarButton
							align='left'
							icon={ThemeIcon.fromId('arrow-left')}
							tooltip={(() => localize('positron.schemaNavigationActionBar.back', 'Back'))()}
							onPressed={() => props.onBack()}
						/>
						<ActionBarSeparator />
						<ActionBarButton
							align='left'
							icon={ThemeIcon.fromId('positron-disconnect-connection')}
							label={(() => localize('positron.schemaNavigationActionBar.disconnect', 'Disconnect'))()}
							onPressed={() => props.onDisconnect()}
						/>
						<ActionBarSeparator />
						<ActionBarButton
							align='left'
							icon={ThemeIcon.fromId('refresh')}
							label={(() => localize('positron.schemaNavigationActionBar.refresh', 'Refresh'))()}
							onPressed={() => props.onRefresh()}
						/>
					</ActionBarRegion>
				</PositronActionBar>
			</PositronActionBarContextProvider>
		</div>
	);
};
