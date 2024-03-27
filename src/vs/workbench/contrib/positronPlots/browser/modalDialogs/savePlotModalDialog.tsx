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
import { Schemas } from 'vs/base/common/network';
import { HTMLFileSystemProvider } from 'vs/platform/files/browser/htmlFileSystemProvider';
import { IFileService } from 'vs/platform/files/common/files';
import { decodeBase64 } from 'vs/base/common/buffer';

interface SavePlotOptions {
	uri: string;
	path: URI;
}

const SAVE_PLOT_MODAL_DIALOG_WIDTH = 500;
const SAVE_PLOT_MODAL_DIALOG_HEIGHT = 600;
const BASE_DPI = 100; // matplotlib default DPI

/**
 * Localized strings.
 */
const title = localize('positronSavePlotModalDialogTitle', 'Save Plot');
const widthLabel = localize('positronSavePlotModalDialogWidth', 'Width');
const heightLabel = localize('positronSavePlotModalDialogHeight', 'Height');
const dpiLabel = localize('positronSavePlotModalDialogDPI', 'DPI');
const previewLabel = localize('positronSavePlotModalDialogUpdatePreview', 'Preview');
const noPathMessage = localize('positronSavePlotModalDialogNoPathMessage', 'Specify a path.');
const saveMessage = localize('positronSave', 'Save');
const dimensionErrorMessage = localize('positronSavePlotModalDialogDimensionError', 'Width and height must be greater than 0.');
const dpiMinMaxErrorMessage = localize('positronSavePlotModalDialogDpiMinMaxError', 'DPI must be between 1 and 300.');
const browsePlaceholderText = localize('positronSavePlotModalDialogBrowsePlaceholder', 'Save plot path');

/**
 * Show the save plot modal dialog for dynamic plots.
 * @param props SavePlotModalDialogProps to set the size and the plot client
 * @returns The requested size and path to save the plot.
 */
export const showSavePlotModalDialog = async (
	layoutService: IWorkbenchLayoutService,
	keybindingService: IKeybindingService,
	fileDialogService: IFileDialogService,
	fileService: IFileService,
	plotClient: PlotClientInstance,
	suggestedPath?: URI
): Promise<SavePlotOptions | undefined> => {


	return new Promise<SavePlotOptions | undefined>((resolve) => {
		// Create the renderer.
		const renderer = new PositronModalReactRenderer({
			keybindingService: keybindingService,
			layoutService: layoutService,
			container: layoutService.activeContainer
		});

		const plotWidth = plotClient.lastRender?.width ?? 100;
		const plotHeight = plotClient.lastRender?.height ?? 100;
		const getPlotUri = (plotData: string) => {
			const regex = /^data:.+\/(.+);base64,(.*)$/;
			const matches = plotData.match(regex);
			if (!matches || matches.length !== 3) {
				return null;
			}
			return matches;
		}
		renderer.render(
			<SavePlotModalDialog
				layoutService={layoutService}
				fileDialogService={fileDialogService}
				renderer={renderer}
				plotWidth={plotWidth}
				plotHeight={plotHeight}
				suggestedPath={suggestedPath}
				savePlot={async (options) => {
					const htmlFileSystemProvider = fileService.getProvider(Schemas.file) as HTMLFileSystemProvider;
					const matches = getPlotUri(options.uri);

					if (!matches) {
						return;
					}

					const data = matches[2];

					htmlFileSystemProvider.writeFile(options.path, decodeBase64(data).buffer, { create: true, overwrite: true, unlock: true, atomic: false })
						.then(() => {
						});
				}}
				plotClient={plotClient}
			/>
		);

		// positronModalDialogReactRenderer.render(<ModalDialog />);
	});
};

interface SavePlotModalDialogProps {
	layoutService: IWorkbenchLayoutService;
	fileDialogService: IFileDialogService;
	renderer: PositronModalReactRenderer;
	plotWidth: number;
	plotHeight: number;
	plotClient: PlotClientInstance;
	suggestedPath?: URI;
	savePlot: (options: SavePlotOptions) => Promise<void>;
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

	React.useEffect(() => {
		validateInput();
	}, [width, height, dpi, path]);

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

	const validateInput = (): boolean => {
		return path.valid && width.valid && height.valid && dpi.valid;
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
			setPath({ value: uri, valid: true });
		}
	};

	const acceptHandler = async () => {
		if (validateInput()) {
			setRendering(true);
			const plotResult = await generatePreview();

			if (plotResult) {
				props.savePlot({ uri: plotResult.uri, path: path.value });
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
				{previewLabel}
			</PositronButton>
		);
	};

	return (
		<PositronModalDialog
			width={SAVE_PLOT_MODAL_DIALOG_WIDTH}
			height={SAVE_PLOT_MODAL_DIALOG_HEIGHT}
			title={title}
			onAccept={acceptHandler}
			onCancel={cancelHandler}
			renderer={props.renderer}>
			<ContentArea>
				<div className='plot-preview-container'>
					<div className='plot-preview-input'>
						<div className='browse'>
							<LabeledFolderInput placeholder={browsePlaceholderText} label={localize('positronSavePlotModalDialogPath', 'Path')}
								value={path.value.fsPath}
								onChange={e => updatePath(e.target.value)}
								onBrowse={browseHandler}
								readOnlyInput={false}
								error={!path.valid}
								inputRef={inputRef} />
						</div>
						<div className='plot-input'>
							<LabeledTextInput label={widthLabel} value={width.value} type={'number'} onChange={e => updateWidth(e.target.value)} min={1} error={!width.valid} />
							<LabeledTextInput label={heightLabel} value={height.value} type={'number'} onChange={e => updateHeight(e.target.value)} min={1} error={!height.valid} />
							<LabeledTextInput label={dpiLabel} value={dpi.value} type={'number'} onChange={e => updateDpi(e.target.value)} min={1} max={300} error={!dpi.valid} />
							<div className='error'>
								<div>
									{!path.valid && noPathMessage}
								</div>
								<div>
									{(!width.valid || !height.valid) && dimensionErrorMessage}
								</div>
								<div>
									{!dpi.valid && dpiMinMaxErrorMessage}
								</div>
							</div>
						</div>
						<div className='preview-progress'>
							{rendering && <ProgressBar />}
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
				<OKCancelActionBar okButtonTitle={saveMessage} onAccept={acceptHandler} onCancel={cancelHandler} preActions={previewButton} />
			</div>

		</PositronModalDialog>
	)
};
