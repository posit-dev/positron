/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./setPlotSizeModalDialog';

// React.
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IPlotSize } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { ContentArea } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/contentArea';
import { PositronModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronModalDialog';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { LabeledTextInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledTextInput';

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
			renderer={renderer}
			customSize={customSize}
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

	// Render.
	return (
		<PositronModalDialog
			renderer={props.renderer}
			width={350}
			height={200}
			title={(() => localize('positronSetPlotSizeModalDialogTitle', "Custom Plot Size"))()}
			onCancel={cancelHandler}>
			<ContentArea>
				<table>
					<tbody>
						<tr>
							<td>
								<LabeledTextInput label={(() => localize(
									'positronPlotWidth',
									"Width"
								))()}
									value={width} autoFocus={true} min={100}
									type='number' onChange={(el) => setWidth(el.target.valueAsNumber)} />
							</td>
							<td>
								<LabeledTextInput label={(() => localize(
									'positronPlotHeight',
									"Height"
								))()}
									value={height} min={100}
									type='number' onChange={(el) => setHeight(el.target.valueAsNumber)} />
							</td>
						</tr>
					</tbody>
				</table>
			</ContentArea>

			<div className='plot-size-action-bar top-separator'>
				<div className='left'>
					<button
						className='button action-bar-button'
						tabIndex={0}
						onClick={deleteHandler}
					>
						{(() => localize('positronDeletePlotSize', "Delete"))()}
					</button>
				</div>
				<div className='right'>
					<button
						className='button action-bar-button default'
						tabIndex={0}
						onClick={acceptHandler}
					>
						{(() => localize('positronOK', "OK"))()}
					</button>
					<button
						className='button action-bar-button'
						tabIndex={0}
						onClick={cancelHandler}
					>
						{(() => localize('positronCancel', "Cancel"))()}
					</button>
				</div>
			</div>
		</PositronModalDialog>
	);
};
