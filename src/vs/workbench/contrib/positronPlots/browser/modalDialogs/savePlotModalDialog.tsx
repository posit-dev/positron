/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./savePlotModalDialog';
import * as React from 'react';
import { ContentArea } from 'vs/base/browser/ui/positronModalDialog/components/contentArea';
import { PositronModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronModalDialog';
import { PositronModalDialogReactRenderer } from 'vs/base/browser/ui/positronModalDialog/positronModalDialogReactRenderer';
import { localize } from 'vs/nls';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { confirmationModalDialog } from 'vs/workbench/browser/positronModalDialogs/confirmationModalDialog';

interface SavePlotOptions {
	width: number;
	height: number;
	path: string;
	dpi: number;
}

interface SavePlotModalDialogProps {
	layoutService: IWorkbenchLayoutService;
	fileDialogService: IFileDialogService;
	plotWidth: number;
	plotHeight: number;
	plotClient: PlotClientInstance;
}

const SAVE_PLOT_MODAL_DIALOG_WIDTH = 600;
const SAVE_PLOT_MODAL_DIALOG_HEIGHT = 700;

/**
 * Show the save plot modal dialog for dynamic plots.
 * @param props SavePlotModalDialogProps to set the size and the plot client
 * @returns The requested size and path to save the plot.
 */
export const showSavePlotModalDialog = async (
	props: SavePlotModalDialogProps
): Promise<SavePlotOptions | undefined> => {


	return new Promise<SavePlotOptions | undefined>((resolve) => {
		const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(props.layoutService.mainContainer);
		const ModalDialog = () => {
			const showSaveDialog = () => {
				props.fileDialogService.showSaveDialog({
					title: 'Save Plot',
					filters:
						[
							{
								extensions: ['png'],
								name: 'PNG',
							},
						],
				}).then(result => {
					if (result) {
						setPath(result.fsPath);
					}
				});
			};
			const [path, setPath] = React.useState('');
			const widthInput = React.useRef<HTMLInputElement>(null);
			const heightInput = React.useRef<HTMLInputElement>(null);
			const dpiInput = React.useRef<HTMLInputElement>(null);
			const [uri, setUri] = React.useState('');

			const browseHandler = async () => {
				showSaveDialog();
			};

			const acceptHandler = async () => {
				const width = parseInt(widthInput.current!.value ?? '100');
				const height = parseInt(heightInput.current!.value ?? '100');
				const dpi = parseInt(dpiInput.current!.value ?? '100');

				if (!path) {
					confirmationModalDialog(props.layoutService,
						localize('positronSavePlotModalDialogNoPathTitle', "No Path Specified"),
						localize('positronSavePlotModalDialogNoPathMessage', "No path was specified."));
					return;
				}

				positronModalDialogReactRenderer.destroy();

				resolve({ width, height, path, dpi });
			};

			const cancelHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve(undefined);
			};

			const updatePreview = () => {
				if (!widthInput.current || !heightInput.current) {
					return;
				}
				const width = parseInt(widthInput.current.value);
				const height = parseInt(heightInput.current.value);
				const dpi = dpiInput.current ? parseInt(dpiInput.current?.value) : props.plotClient.lastRender?.pixel_ratio ?? 100;
				props.plotClient.preview(height, width, dpi / 100)
					.then((result) => {
						setUri(result.uri);
					});
			};

			React.useEffect(() => {
				setUri(props.plotClient.lastRender?.uri ?? '');
				if (!widthInput.current || !heightInput.current) {
					return;
				}
				widthInput.current.focus();
			}, [props.plotClient.lastRender?.uri]);

			return (
				<PositronModalDialog
					width={SAVE_PLOT_MODAL_DIALOG_WIDTH}
					height={SAVE_PLOT_MODAL_DIALOG_HEIGHT}
					title={localize('positronSavePlotModalDialogTitle', "Save Plot")}
					accept={acceptHandler}
					cancel={cancelHandler}>
					<ContentArea>
						<div className='plot-preview-container'>
							<div className='plot-preview-input'>
								<div className='horizontal-input'>
									<input className='text-input' type='text' id='plotPath' value={path} readOnly />
									<button className='button action-bar-button' tabIndex={0} onClick={browseHandler}>{localize('positronSavePlotModalDialogBrowse', "Browse...")}</button>
								</div>
								<div className='horizontal-input'>
									<label htmlFor='plotWidth'>{localize('positronSavePlotModalDialogWidth', "Width:")}</label>
									<input className='text-input' type='number' id='plotWidth' defaultValue={props.plotWidth} ref={widthInput} />
									{localize('positronPlotPixelsAbbrev', 'px')}
								</div>
								<div className='horizontal-input'>
									<label htmlFor='plotHeight'>{localize('positronSavePlotModalDialogHeight', "Height:")}</label>
									<input className='text-input' type='number' id='plotHeight' defaultValue={props.plotHeight} ref={heightInput} />
									{localize('positronPlotPixelsAbbrev', 'px')}
								</div>
								<div className='horizontal-input'>
									<label htmlFor='plotHeight'>{localize('positronSavePlotModalDialogDPI', "DPI:")}</label>
									<input className='text-input' type='number' id='plotDPI' defaultValue={100} ref={dpiInput} />
								</div>
							</div>
							{
								uri &&
								<div className='plot-preview-image-wrapper'>
									<img className='plot-preview' src={uri} />
								</div>
							}
						</div>
					</ContentArea>

					<div className='plot-save-dialog-action-bar top-separator'>
						<div className='left'>
							<button className='button action-bar-button' onClick={updatePreview}>
								{localize('positronSavePlotModalDialogUpdatePreview', "Preview")}
							</button>
						</div>
						<div className='right'>
							<PositronButton className='button default action-bar-button' onPressed={acceptHandler}>
								{localize('positronSave', "Save")}
							</PositronButton>
							<PositronButton className='button action-bar-button' onPressed={cancelHandler}>
								{localize('positronCancel', "Cancel")}
							</PositronButton>
						</div>
					</div>

				</PositronModalDialog>
			);
		};

		positronModalDialogReactRenderer.render(<ModalDialog />);
	});
};
