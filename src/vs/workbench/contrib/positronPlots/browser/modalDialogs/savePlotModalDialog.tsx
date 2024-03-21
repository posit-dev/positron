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
import { IRenderedPlot, PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { URI } from 'vs/base/common/uri';
import { LabeledTextInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledTextInput';
import { LabeledFolderInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledFolderInput';
import { OKCancelActionBar } from 'vs/base/browser/ui/positronModalDialog/components/okCancelActionBar';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';

interface SavePlotOptions {
	uri: string;
	path: URI;
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
const BASE_DPI = 100; // matplotlib default DPI

/**
 * Localized strings.
 */
const title = localize('positronSavePlotModalDialogTitle', 'Save Plot');
const widthLabel = localize('positronSavePlotModalDialogWidth', 'Width');
const heightLabel = localize('positronSavePlotModalDialogHeight', 'Height');
const dpiLabel = localize('positronSavePlotModalDialogDPI', 'DPI');
const previewLabel = localize('positronSavePlotModalDialogUpdatePreview', 'Preview');
const noPathMessage = localize('positronSavePlotModalDialogNoPathMessage', 'No path was specified.');
const saveMessage = localize('positronSave', 'Save');
const dimensionErrorMessage = localize('positronSavePlotModalDialogDimensionError', 'Must be greater than 0.');
const dpiMinMaxErrorMessage = localize('positronSavePlotModalDialogDpiMinMaxError', 'Must be between 1 and 300.');

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
			const [path, setPath] = React.useState<URI>();
			const [width, setWidth] = React.useState(props.plotWidth);
			const [height, setHeight] = React.useState(props.plotHeight);
			const [dpi, setDpi] = React.useState(100);
			const [uri, setUri] = React.useState('');
			const [rendering, setRendering] = React.useState(false);
			const [widthError, setWidthError] = React.useState('');
			const [heightError, setHeightError] = React.useState('');
			const [dpiError, setDpiError] = React.useState('');
			const [pathError, setPathError] = React.useState('');
			const firstRender = React.useRef(true);

			const validateInput = () => {
				let valid = true;

				setWidthError('');
				setHeightError('');
				setDpiError('');
				setPathError('');

				if (width <= 0) {
					setWidthError(dimensionErrorMessage);
					valid = false;
				}
				if (height <= 0) {
					setHeightError(dimensionErrorMessage);
					valid = false;
				}
				if (!path) {
					setPathError(noPathMessage);
					valid = false;
				}
				if (dpi <= 0) {
					setDpiError(dimensionErrorMessage);
					valid = false;
				}
				if (dpi < 1 || dpi > 300) {
					setDpiError(dpiMinMaxErrorMessage);
					valid = false;
				}

				return valid;
			};

			const browseHandler = async () => {
				const uri = await props.fileDialogService.showSaveDialog({
					title: title,
					filters:
						[
							{
								extensions: ['png'],
								name: 'PNG',
							},
						],
				});

				if (uri?.fsPath.length) {
					setPath(uri);
				}
			};

			const acceptHandler = async () => {
				if (!validateInput()) {
					return;
				}

				positronModalDialogReactRenderer.destroy();

				const plotResult = await generatePreview();

				if (!plotResult) {
					resolve(undefined);
				} else {
					// @ts-expect-error: path is checked in the validateInput function
					resolve({ uri: plotResult.uri, path });
				}
			};

			const cancelHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve(undefined);
			};

			const updatePreview = async () => {
				if (validateInput()) {

				}
				setRendering(true);
				try {
					const plotResult = await generatePreview();
					setUri(plotResult.uri);
				} finally {
					setRendering(false);
				}
			};

			const generatePreview = async (): Promise<IRenderedPlot> => {
				return props.plotClient.preview(height, width, dpi / BASE_DPI);
			};

			const previewButton = () => {
				return (
					<PositronButton className='button action-bar-button' onPressed={updatePreview}>
						{previewLabel}
					</PositronButton>
				);
			};

			React.useEffect(() => {
				setUri(props.plotClient.lastRender?.uri ?? '');
			}, [props.plotClient.lastRender?.uri]);

			// Only vaidate after first render to avoid showing errors on initial load
			React.useEffect(() => {
				if (!firstRender.current) {
					validateInput();
				}
				firstRender.current = false;
			}, [width, height, dpi, path]);
			// align the inputs for each row
			// set placeholder on the path input
			// maybe a label on the path input

			// grid
			// validation and put a red border around the invalid input
			// see LabeledTextInput, modify for showing an error
			// see LabeledFolderInput
			return (
				<PositronModalDialog
					width={SAVE_PLOT_MODAL_DIALOG_WIDTH}
					height={SAVE_PLOT_MODAL_DIALOG_HEIGHT}
					title={title}
					accept={acceptHandler}
					cancel={cancelHandler}>
					<ContentArea>
						<div className='plot-preview-container'>
							<div className='plot-preview-input'>
								<div className='browse'>
									<LabeledFolderInput label={localize('positronSavePlotModalDialogPath', 'Path')}
										value={path?.fsPath ?? ''}
										onChange={() => { }}
										onBrowse={browseHandler}
										error={pathError} />
								</div>
								<div className='resolution'>
									<LabeledTextInput label={widthLabel} value={width} type={'number'} onChange={e => { setWidth(parseInt(e.target.value)); }} error={widthError} min={1} />
									<LabeledTextInput label={heightLabel} value={height} type={'number'} onChange={e => { setHeight(parseInt(e.target.value)); }} error={heightError} min={1} />
								</div>
								<div className='dpi'>
									<LabeledTextInput label={dpiLabel} value={dpi} type={'number'} onChange={e => { setDpi(parseInt(e.target.value)); }} error={dpiError} min={1} max={300} />
								</div>
								<div className='preview-progress'>
									{rendering && <progress style={{ width: '100%' }} value={undefined} />}
								</div>
								<div className='plot-preview-image-container preview'>
									{(uri &&
										<img className='plot-preview' src={uri} />)
									}
								</div>
							</div>
						</div>
					</ContentArea>

					<div className='plot-save-dialog-action-bar top-separator'>
						<OKCancelActionBar okButtonTitle={saveMessage} accept={acceptHandler} cancel={cancelHandler} preActions={previewButton} />
					</div>

				</PositronModalDialog>
			);
		};

		positronModalDialogReactRenderer.render(<ModalDialog />);
	});
};
