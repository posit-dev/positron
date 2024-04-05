/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./savePlotModalDialog';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IRenderedPlot, PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { URI } from 'vs/base/common/uri';
import { ProgressBar } from 'vs/base/browser/ui/positronComponents/progressBar';
import { LabeledTextInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledTextInput';
import { LabeledFolderInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledFolderInput';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/button/positronButton';
import { ContentArea } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/contentArea';
import { OKCancelActionBar } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/okCancelActionBar';
import { PositronModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronModalDialog';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';

export interface SavePlotOptions {
	uri: string;
	path: URI;
}

const SAVE_PLOT_MODAL_DIALOG_WIDTH = 500;
const SAVE_PLOT_MODAL_DIALOG_HEIGHT = 600;
const BASE_DPI = 100; // matplotlib default DPI

/**
 * Show the save plot modal dialog for dynamic plots.
 * @param layoutService the layout service for the modal
 * @param keybindingService the keybinding service to intercept shortcuts
 * @param fileDialogService the file dialog service to prompt where to save the plot
 * @param plotClient the dynamic plot client to render previews and the final image
 * @param savePlotCallback the action to take when the dialog closes
 * @param suggestedPath the pre-filled save path
 */
export const showSavePlotModalDialog = async (
	layoutService: IWorkbenchLayoutService,
	keybindingService: IKeybindingService,
	fileDialogService: IFileDialogService,
	plotClient: PlotClientInstance,
	savePlotCallback: (options: SavePlotOptions) => void,
	suggestedPath?: URI,
) => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		keybindingService: keybindingService,
		layoutService: layoutService,
		container: layoutService.activeContainer
	});

	const plotWidth = plotClient.lastRender?.width ?? 100;
	const plotHeight = plotClient.lastRender?.height ?? 100;

	renderer.render(
		<SavePlotModalDialog
			layoutService={layoutService}
			fileDialogService={fileDialogService}
			renderer={renderer}
			plotWidth={plotWidth}
			plotHeight={plotHeight}
			suggestedPath={suggestedPath}
			savePlotCallback={savePlotCallback}
			plotClient={plotClient}
		/>
	);
};

interface SavePlotModalDialogProps {
	layoutService: IWorkbenchLayoutService;
	fileDialogService: IFileDialogService;
	renderer: PositronModalReactRenderer;
	plotWidth: number;
	plotHeight: number;
	plotClient: PlotClientInstance;
	savePlotCallback: (options: SavePlotOptions) => void;
	suggestedPath?: URI;
}

const SavePlotModalDialog = (props: SavePlotModalDialogProps) => {
	const [path, setPath] = React.useState({ value: props.suggestedPath ?? URI.file(''), valid: true });
	const [width, setWidth] = React.useState({ value: props.plotWidth, valid: true });
	const [height, setHeight] = React.useState({ value: props.plotHeight, valid: true });
	const [dpi, setDpi] = React.useState({ value: 100, valid: true });
	const [uri, setUri] = React.useState('');
	const [rendering, setRendering] = React.useState(false);
	const inputRef = React.useRef<HTMLInputElement>(null);

	React.useEffect(() => {
		setUri(props.plotClient.lastRender?.uri ?? '');
	}, [props.plotClient.lastRender?.uri]);

	const validateInput = React.useCallback((): boolean => {
		return path.valid && width.valid && height.valid && dpi.valid;
	}, [path, width, height, dpi]);

	React.useEffect(() => {
		validateInput();
	}, [validateInput]);

	const updateWidth = (widthString: string): void => {
		const newWidth = parseInt(widthString);
		setWidth({ value: newWidth, valid: newWidth > 0 && !isNaN(newWidth) });
	};

	const updateHeight = (heightString: string): void => {
		const newHeight = parseInt(heightString);
		setHeight({ value: newHeight, valid: newHeight > 0 && !isNaN(newHeight) });
	};

	const updateDpi = (dpiString: string): void => {
		const newDpi = parseInt(dpiString);
		setDpi({ value: newDpi, valid: newDpi >= 1 && newDpi <= 300 && !isNaN(newDpi) });
	};

	const updatePath = (pathString: string) => {
		const newPath = URI.file(pathString);
		setPath({ value: newPath, valid: !!newPath });
	};

	const browseHandler = async () => {
		const uri = await props.fileDialogService.showSaveDialog({
			title: localize('positron.savePlotModalDialog.title', "Save Plot"),
			filters:
				[
					{
						extensions: ['png'],
						name: 'PNG',
					},
				],
		});

		if (uri?.fsPath.length) {
			setPath({ value: uri, valid: true });
		}
	};

	const acceptHandler = async () => {
		if (validateInput()) {
			setRendering(true);
			const plotResult = await generatePreview();

			if (plotResult) {
				props.savePlotCallback({ uri: plotResult.uri, path: path.value });
			}

			setRendering(false);
			props.renderer.dispose();
		}
	};

	const cancelHandler = () => {
		props.renderer.dispose();
	};

	const updatePreview = async () => {
		if (!validateInput() || rendering) {
			return;
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
		return props.plotClient.preview(height.value, width.value, dpi.value / BASE_DPI);
	};

	const previewButton = () => {
		return (
			<PositronButton className='button action-bar-button' onPressed={updatePreview}>
				{(() => localize('positron.savePlotModalDialog.updatePreview', "Preview"))()}
			</PositronButton>
		);
	};

	return (
		<PositronModalDialog
			width={SAVE_PLOT_MODAL_DIALOG_WIDTH}
			height={SAVE_PLOT_MODAL_DIALOG_HEIGHT}
			title={(() => localize('positron.savePlotModalDialog.title', "Save Plot"))()}
			onAccept={acceptHandler}
			onCancel={cancelHandler}
			renderer={props.renderer}>
			<ContentArea>
				<div className='plot-preview-container'>
					<div className='plot-preview-input'>
						<div className='browse'>
							<LabeledFolderInput
								label={(() => localize(
									'positron.savePlotModalDialog.path',
									"Path"
								))()}
								value={path.value.fsPath}
								onChange={e => updatePath(e.target.value)}
								onBrowse={browseHandler}
								readOnlyInput={false}
								error={!path.valid}
								inputRef={inputRef} />
						</div>
						<div className='plot-input'>
							<LabeledTextInput
								label={(() => localize(
									'positron.savePlotModalDialog.width',
									"Width"
								))()}
								value={width.value}
								type={'number'}
								onChange={e => updateWidth(e.target.value)}
								min={1}
								error={!width.valid}
							/>
							<LabeledTextInput
								label={(() => localize(
									'positron.savePlotModalDialog.height',
									"Height"
								))()}
								value={height.value}
								type={'number'}
								onChange={e => updateHeight(e.target.value)}
								min={1}
								error={!height.valid}
							/>
							<LabeledTextInput
								label={(() => localize(
									'positron.savePlotModalDialog.dpi',
									"DPI"
								))()}
								value={dpi.value}
								type={'number'}
								onChange={e => updateDpi(e.target.value)}
								min={1}
								max={300}
								error={!dpi.valid}
							/>
							<div className='error'>
								<div>
									{!path.valid && (() => localize(
										'positron.savePlotModalDialog.noPathMessage',
										"Specify a path."
									))()}
								</div>
								<div>
									{(!width.valid || !height.valid) && (() => localize(
										'positron.savePlotModalDialog.dimensionError',
										"Width and height must be greater than 0."
									))()}
								</div>
								<div>
									{!dpi.valid && (() => localize(
										'positron.savePlotModalDialog.dpiMinMaxError',
										"DPI must be between 1 and 300."
									))()}
								</div>
							</div>
						</div>
						<div className='preview-progress'>
							{rendering && <ProgressBar />}
						</div>
						<div className='plot-preview-image-container preview'>
							{(uri &&
								<img className='plot-preview' src={uri} alt={props.plotClient.metadata.code} />)
							}
						</div>
					</div>
				</div>
			</ContentArea>

			<div className='plot-save-dialog-action-bar top-separator'>
				<OKCancelActionBar
					okButtonTitle={(() => localize(
						'positron.savePlotModalDialog.save',
						"Save"
					))()}
					onAccept={acceptHandler}
					onCancel={cancelHandler}
					preActions={previewButton}
				/>
			</div>

		</PositronModalDialog>
	);
};
