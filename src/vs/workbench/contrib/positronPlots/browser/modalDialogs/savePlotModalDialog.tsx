/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./savePlotModalDialog';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { IDialogService, IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
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
import { FileFilter } from 'electron';
import { DropDownListBox } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { IFileService } from 'vs/platform/files/common/files';
import { IntrinsicSize, PlotUnit, RenderFormat } from 'vs/workbench/services/languageRuntime/common/positronPlotComm';
import { Checkbox } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/checkbox';
import { IPlotSize, IPositronPlotSizingPolicy } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import { ILogService } from 'vs/platform/log/common/log';
import { PlotSizingPolicyIntrinsic } from 'vs/workbench/services/positronPlots/common/sizingPolicyIntrinsic';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IRenderedPlot } from 'vs/workbench/services/languageRuntime/common/positronPlotCommProxy';

export interface SavePlotOptions {
	uri: string;
	path: URI;
}

const SAVE_PLOT_MODAL_DIALOG_WIDTH = 500;
const SAVE_PLOT_MODAL_DIALOG_HEIGHT = 600;
const BASE_DPI = 100; // matplotlib default DPI

/**
 * Show the save plot modal dialog for dynamic plots.
 * @param selectedSizingPolicy the selected sizing policy for the plot
 * @param layoutService the layout service for the modal
 * @param keybindingService the keybinding service to intercept shortcuts
 * @param dialogService the dialog service to confirm the save
 * @param fileService the file service to check if paths exist
 * @param fileDialogService the file dialog service to prompt where to save the plot
 * @param logService the log service
 * @param notificationService the notification service to show user-facing notifications
 * @param plotClient the dynamic plot client to render previews and the final image
 * @param savePlotCallback the action to take when the dialog closes
 * @param suggestedPath the pre-filled save path
 */
export const showSavePlotModalDialog = (
	selectedSizingPolicy: IPositronPlotSizingPolicy,
	layoutService: IWorkbenchLayoutService,
	keybindingService: IKeybindingService,
	dialogService: IDialogService,
	fileService: IFileService,
	fileDialogService: IFileDialogService,
	logService: ILogService,
	notificationService: INotificationService,
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

	renderer.render(
		<SavePlotModalDialog
			layoutService={layoutService}
			dialogService={dialogService}
			fileService={fileService}
			fileDialogService={fileDialogService}
			keybindingService={keybindingService}
			logService={logService}
			notificationService={notificationService}
			renderer={renderer}
			enableIntrinsicSize={selectedSizingPolicy instanceof PlotSizingPolicyIntrinsic}
			plotSize={plotClient.lastRender?.size}
			plotIntrinsicSize={plotClient.intrinsicSize}
			suggestedPath={suggestedPath}
			savePlotCallback={savePlotCallback}
			plotClient={plotClient}
		/>
	);
};

interface SavePlotModalDialogProps {
	layoutService: IWorkbenchLayoutService;
	dialogService: IDialogService;
	fileService: IFileService;
	fileDialogService: IFileDialogService;
	logService: ILogService;
	notificationService: INotificationService;
	keybindingService: IKeybindingService;
	renderer: PositronModalReactRenderer;
	enableIntrinsicSize: boolean;
	plotSize: IPlotSize | undefined;
	plotIntrinsicSize: IntrinsicSize | undefined;
	plotClient: PlotClientInstance;
	savePlotCallback: (options: SavePlotOptions) => void;
	suggestedPath?: URI;
}

interface DirectoryState {
	value: URI;
	valid: boolean;
	errorMessage?: string;
}

const SavePlotModalDialog = (props: SavePlotModalDialogProps) => {
	const [directory, setDirectory] = React.useState<DirectoryState>({ value: props.suggestedPath ?? URI.file(''), valid: true });
	const [name, setName] = React.useState({ value: 'plot', valid: true });
	const [format, setFormat] = React.useState(RenderFormat.Png);
	const [enableIntrinsicSize, setEnableIntrinsicSize] = React.useState(props.enableIntrinsicSize);
	const [width, setWidth] = React.useState({ value: props.plotSize?.width ?? 100, valid: true });
	const [height, setHeight] = React.useState({ value: props.plotSize?.height ?? 100, valid: true });
	const [dpi, setDpi] = React.useState({ value: 100, valid: true });
	const [uri, setUri] = React.useState('');
	const [rendering, setRendering] = React.useState(false);
	const inputRef = React.useRef<HTMLInputElement>(null);

	const filterEntries: FileFilter[] = [];
	for (const filter in RenderFormat) {
		filterEntries.push({ extensions: [filter.toLowerCase()], name: filter.toUpperCase() });
	}

	// hide DPI as it may be configurable for PDF in the future
	const enableDPI = false;

	React.useEffect(() => {
		setUri(props.plotClient.lastRender?.uri ?? '');
	}, [props.plotClient.lastRender?.uri]);

	const validateInput = React.useCallback((): boolean => {
		return directory.valid && width.valid && height.valid && dpi.valid && name.valid;
	}, [directory, width, height, dpi, name]);

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
		try {
			const newPath = URI.file(pathString);
			props.fileService.exists(newPath).then(exists => {
				setDirectory({
					value: newPath, valid: exists,
					errorMessage: exists ? undefined : localize('positron.savePlotModalDialog.pathDoesNotExist', "Path does not exist.")
				});
			});
		} catch (error) {
			setDirectory({ value: URI.file(''), valid: false, errorMessage: error.message });
		}
	};

	const browseHandler = async () => {
		const uri = await props.fileDialogService.showOpenDialog({
			title: localize('positron.savePlotModalDialog.title', "Save Plot"),
			defaultUri: directory.value,
			openLabel: localize('positron.savePlotModalDialog.select', "Select"),
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
		});

		if (uri && uri.length > 0) {
			updatePath(uri[0].fsPath);
		}
	};

	const acceptHandler = async () => {
		if (validateInput()) {
			const filePath = URI.joinPath(directory.value, `${name.value}.${format}`);
			const fileExists = await props.fileService.exists(filePath);
			if (fileExists) {
				const confirmation = await props.dialogService.confirm({
					message: localize('positron.savePlotModalDialog.fileExists', "The file already exists. Do you want to overwrite it?"),
					primaryButton: localize('positron.savePlotModalDialog.overwrite', "Overwrite"),
					cancelButton: localize('positron.savePlotModalDialog.cancel', "Cancel"),
				});
				if (!confirmation.confirmed) {
					return;
				}
			}
			setRendering(true);

			generatePreview(format)
				.then(async (plotResult) => {
					props.savePlotCallback({ uri: plotResult.uri, path: filePath });
				})
				.catch((error) => {
					props.notificationService.error(localize('positron.savePlotModalDialog.errorSavingPlot', "Error saving plot: {0}", error.toString()));
				})
				.finally(() => {
					setRendering(false);
					props.renderer.dispose();
				});
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
			const plotResult = await generatePreview(RenderFormat.Png);
			setUri(plotResult.uri);
		} catch (error) {
			props.logService.error('Error rendering plot:', error);
		} finally {
			setRendering(false);
		}
	};

	const generatePreview = async (format: RenderFormat): Promise<IRenderedPlot> => {
		let size: IPlotSize | undefined;
		if (!enableIntrinsicSize) {
			if (!width.value || !height.value) {
				throw new Error('Width and height must be defined for plots that do not support intrinsic size.');
			}
			size = { height: height.value, width: width.value };
		}
		return props.plotClient.preview(size, dpi.value / BASE_DPI, format);
	};

	const previewButton = () => {
		return (
			<PositronButton className='button action-bar-button' onPressed={updatePreview}>
				{(() => localize('positron.savePlotModalDialog.updatePreview', "Preview"))()}
			</PositronButton>
		);
	};

	let displayWidth: number;
	let displayHeight: number;
	if (enableIntrinsicSize && props.plotIntrinsicSize) {
		displayWidth = props.plotIntrinsicSize.width;
		displayHeight = props.plotIntrinsicSize.height;

		// Convert intrinsic size to pixels if necessary
		if (props.plotIntrinsicSize.unit === PlotUnit.Inches) {
			displayWidth *= dpi.value;
			displayHeight *= dpi.value;
		}
	} else {
		displayWidth = width.value;
		displayHeight = height.value;
	}

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
									'positron.savePlotModalDialog.directory',
									"Directory"
								))()}
								value={directory.value.fsPath}
								onChange={e => updatePath(e.target.value)}
								onBrowse={browseHandler}
								readOnlyInput={false}
								error={!directory.valid}
								inputRef={inputRef} />
						</div>
						<div className='file'>
							<LabeledTextInput
								label={(() => localize(
									'positron.savePlotModalDialog.name',
									"Name"
								))()}
								value={name.value}
								onChange={e => setName({ value: e.target.value, valid: !!e.target.value })}
								error={!name.valid}
							/>
							<div>
								<label>{(() => localize('positron.savePlotModalDialog.format', "Format"))()}
									<DropDownListBox
										title={(() => localize(
											'positron.savePlotModalDialog.format',
											"Format"
										))()}
										selectedIdentifier={format}
										onSelectionChanged={(ext) => { setFormat(ext.options.identifier); }}
										keybindingService={props.keybindingService}
										layoutService={props.layoutService}
										entries={[
											new DropDownListBoxItem<RenderFormat, RenderFormat>({ identifier: RenderFormat.Png, title: RenderFormat.Png.toUpperCase(), value: RenderFormat.Png }),
											new DropDownListBoxItem<RenderFormat, RenderFormat>({ identifier: RenderFormat.Jpeg, title: RenderFormat.Jpeg.toUpperCase(), value: RenderFormat.Jpeg }),
											new DropDownListBoxItem<RenderFormat, RenderFormat>({ identifier: RenderFormat.Svg, title: RenderFormat.Svg.toUpperCase(), value: RenderFormat.Svg }),
											new DropDownListBoxItem<RenderFormat, RenderFormat>({ identifier: RenderFormat.Pdf, title: RenderFormat.Pdf.toUpperCase(), value: RenderFormat.Pdf }),
										]} />
								</label>
							</div>
						</div>
						<div className='plot-input'>
							<LabeledTextInput
								label={(() => localize(
									'positron.savePlotModalDialog.width',
									"Width"
								))()}
								value={displayWidth}
								type={'number'}
								onChange={e => updateWidth(e.target.value)}
								min={1}
								error={!width.valid}
								disabled={enableIntrinsicSize}
							/>
							<LabeledTextInput
								label={(() => localize(
									'positron.savePlotModalDialog.height',
									"Height"
								))()}
								value={displayHeight}
								type={'number'}
								onChange={e => updateHeight(e.target.value)}
								min={1}
								error={!height.valid}
								disabled={enableIntrinsicSize}
							/>
							{enableDPI && <LabeledTextInput
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
							/>}
							<div className='error'>
								<div>
									{!directory.valid && (() => localize(
										'positron.savePlotModalDialog.invalidPathError',
										"Invalid path: {0}", directory.errorMessage
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
								<div>
									{!name.valid && (() => localize(
										'positron.savePlotModalDialog.invalidNameError',
										"Plot name cannot be empty."
									))()}
								</div>
							</div>
						</div>
						<div className='use-intrinsic-size'>
							{props.plotIntrinsicSize ? <Checkbox
								label={(() => localize(
									'positron.savePlotModalDialog.useIntrinsicSize',
									"Use intrinsic size"
								))()}
								initialChecked={enableIntrinsicSize}
								onChanged={checked => setEnableIntrinsicSize(checked)} /> : null}
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
