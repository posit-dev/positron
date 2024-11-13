/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./editorActionBar';

// React.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { isAuxiliaryWindow } from 'vs/base/browser/window';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

// Constants.
const PADDING_LEFT = 8;
const PADDING_RIGHT = 8;

/**
 * EditorActionBarServices interface.
 */
interface EditorActionBarServices extends PositronActionBarServices {
}

/**
 * EditorActionBarProps interface
 */
interface EditorActionBarProps extends EditorActionBarServices {
}

/**
 * Localized strings.
 */
const moveIntoNewWindowButtonDescription = localize(
	'positron.moveIntoNewWindow',
	"Move into New Window"
);

/**
 * EditorActionBar component.
 * @returns The rendered component.
 */
export const EditorActionBar = (props: EditorActionBarProps) => {
	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [moveIntoNewWindowDisabled, setMoveIntoNewWindowDisabled] = useState(true);

	// Main useEffect.
	useEffect(() => {
		setMoveIntoNewWindowDisabled(isAuxiliaryWindow(DOM.getWindow(ref.current)));
	}, []);

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div ref={ref} className='editor-action-bar'>
				<PositronActionBar
					size='small'
					borderTop={false}
					borderBottom={true}
					paddingLeft={PADDING_LEFT}
					paddingRight={PADDING_RIGHT}
				>
					<ActionBarRegion location='right'>
						<ActionBarButton
							disabled={moveIntoNewWindowDisabled}
							iconId='positron-open-in-new-window'
							tooltip={moveIntoNewWindowButtonDescription}
							ariaLabel={moveIntoNewWindowButtonDescription}
							onPressed={() =>
								props.commandService.executeCommand(
									'workbench.action.moveEditorToNewWindow'
								)
							}
						/>
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
