/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './setPlotSizeModalDialog.css';

// React.
import React, { useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IPlotSize } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { PositronModalReactRenderer } from '../../../../browser/positronModalReactRenderer/positronModalReactRenderer.js';
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { PlatformNativeDialogActionBar } from '../../../../browser/positronComponents/positronModalDialog/components/platformNativeDialogActionBar.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

/**
 * SetPlotSizeResult interface.
 */
export interface SetPlotSizeResult {
	size: IPlotSize;
}

/**
 * Shows a dialog that allows the user to set a custom plot size.
 * @param keybindingService The keybinding service.
 * @param layoutService The layout service.
 * @param customSize The custom size, or, undefined.
 * @param setPlotSize The set plot size callback.
 */
export const showSetPlotSizeModalDialog = async (
	keybindingService: IKeybindingService,
	layoutService: IWorkbenchLayoutService,
	customSize: IPlotSize | undefined,
	setPlotSize: (result?: SetPlotSizeResult | null) => void
) => {
	// Create the modal React renderer.
	const renderer = new PositronModalReactRenderer({
		keybindingService,
		layoutService,
		container: layoutService.activeContainer
	});

	// Show the set plot size modal dialog.
	renderer.render(
		<SetPlotSizeModalDialog
			customSize={customSize}
			renderer={renderer}
			setPlotSize={setPlotSize}
		/>
	);
};

/**
 * SetPlotSizeModalDialogProps interface.
 */
interface SetPlotSizeModalDialogProps {
	renderer: PositronModalReactRenderer;
	customSize: IPlotSize | undefined;
	setPlotSize: (result?: SetPlotSizeResult | null) => void;
}

/**
 * SetPlotSizeModalDialog component.
 * @param props The component properties.
 * @returns The rendered component.
 */
const SetPlotSizeModalDialog = (props: SetPlotSizeModalDialogProps) => {
	const [width, setWidth] = useState(props.customSize?.width ?? 100);
	const [height, setHeight] = useState(props.customSize?.height ?? 100);

	// The accept handler.
	const acceptHandler = () => {
		let result: SetPlotSizeResult | undefined = undefined;
		result = {
			size: {
				width: width,
				height: height
			}
		};
		props.renderer.dispose();
		props.setPlotSize(result);
	};

	// The delete handler.
	const deleteHandler = () => {
		props.renderer.dispose();
		props.setPlotSize(null);
	};

	// The cancel handler.
	const cancelHandler = () => {
		props.renderer.dispose();
	};

	const okButton = (
		<Button
			className='action-bar-button default'
			tabIndex={0}
			onPressed={acceptHandler}
		>
			{(() => localize('positronOK', "OK"))()}
		</Button>
	);
	const cancelButton = (
		<Button
			className='action-bar-button'
			tabIndex={0}
			onPressed={cancelHandler}
		>
			{(() => localize('positronCancel', "Cancel"))()}
		</Button>
	);

	// Render.
	return (
		<PositronModalDialog
			height={200}
			renderer={props.renderer}
			title={(() => localize('positronSetPlotSizeModalDialogTitle', "Custom Plot Size"))()}
			width={350}
			onCancel={cancelHandler}>
			<ContentArea>
				<table>
					<tbody>
						<tr>
							<td>
								<LabeledTextInput autoFocus={true}
									label={(() => localize(
										'positronPlotWidth',
										"Width"
									))()} min={100} type='number'
									value={width} onChange={(el) => setWidth(el.target.valueAsNumber)} />
							</td>
							<td>
								<LabeledTextInput label={(() => localize(
									'positronPlotHeight',
									"Height"
								))()}
									min={100} type='number'
									value={height} onChange={(el) => setHeight(el.target.valueAsNumber)} />
							</td>
						</tr>
					</tbody>
				</table>
			</ContentArea>

			<div className='plot-size-action-bar top-separator'>
				<div className='left'>
					<Button
						className='action-bar-button'
						tabIndex={0}
						onPressed={deleteHandler}
					>
						{(() => localize('positronDeletePlotSize', "Delete"))()}
					</Button>
				</div>
				<div className='right'>
					<PlatformNativeDialogActionBar primaryButton={okButton} secondaryButton={cancelButton} />
				</div>
			</div>
		</PositronModalDialog>
	);
};
