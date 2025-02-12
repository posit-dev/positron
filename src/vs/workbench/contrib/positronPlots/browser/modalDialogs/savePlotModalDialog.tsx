/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './savePlotModalDialog.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { URI } from '../../../../../base/common/uri.js';
import { ProgressBar } from '../../../../../base/browser/ui/positronComponents/progressBar.js';
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { LabeledFolderInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledFolderInput.js';
import { PositronButton } from '../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PlatformNativeDialogActionBar } from '../../../../browser/positronComponents/positronModalDialog/components/platformNativeDialogActionBar.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { PositronModalReactRenderer } from '../../../../browser/positronModalReactRenderer/positronModalReactRenderer.js';
import { FileFilter } from 'electron';
import { DropDownListBox } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IntrinsicSize, RenderFormat } from '../../../../services/languageRuntime/common/positronPlotComm.js';
import { Checkbox } from '../../../../browser/positronComponents/positronModalDialog/components/checkbox.js';
import { IPlotSize, IPositronPlotSizingPolicy } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { formatPlotUnit, PlotSizingPolicyIntrinsic } from '../../../../services/positronPlots/common/sizingPolicyIntrinsic.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IRenderedPlot } from '../../../../services/languageRuntime/common/positronPlotCommProxy.js';
import { IPositronModalDialogsService } from '../../../../services/positronModalDialogs/common/positronModalDialogs.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { combineLabelWithPathUri, pathUriToLabel } from '../../../../browser/utils/path.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

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
 * @param modalDialogService the dialog service to confirm the save
 * @param fileService the file service to check if paths exist
 * @param fileDialogService the file dialog service to prompt where to save the plot
 * @param logService the log service
 * @param notificationService the notification service to show user-facing notifications
 * @param labelService the label service
 * @param pathService the path service
 * @param plotClient the dynamic plot client to render previews and the final image
 * @param savePlotCallback the action to take when the dialog closes
 * @param suggestedPath the pre-filled save path
 */
export const showSavePlotModalDialog = (
	selectedSizingPolicy: IPositronPlotSizingPolicy,
	layoutService: IWorkbenchLayoutService,
	keybindingService: IKeybindingService,
	modalDialogService: IPositronModalDialogsService,
	fileService: IFileService,
	fileDialogService: IFileDialogService,
	logService: ILogService,
	notificationService: INotificationService,
	labelService: ILabelService,
	pathService: IPathService,
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
			dialogService={modalDialogService}
			enableIntrinsicSize={selectedSizingPolicy instanceof PlotSizingPolicyIntrinsic}
			fileDialogService={fileDialogService}
			fileService={fileService}
			keybindingService={keybindingService}
			labelService={labelService}
			layoutService={layoutService}
			logService={logService}
			notificationService={notificationService}
			pathService={pathService}
			plotClient={plotClient}
			plotIntrinsicSize={plotClient.intrinsicSize}
			plotSize={plotClient.lastRender?.size}
			renderer={renderer}
			savePlotCallback={savePlotCallback}
			suggestedPath={suggestedPath}
		/>
	);
};

interface SavePlotModalDialogProps {
	layoutService: IWorkbenchLayoutService;
	dialogService: IPositronModalDialogsService;
	fileService: IFileService;
	fileDialogService: IFileDialogService;
	logService: ILogService;
	notificationService: INotificationService;
	keybindingService: IKeybindingService;
	labelService: ILabelService;
	pathService: IPathService;
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
	const inputRef = React.useRef<HTMLInputElement>(null!);

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

	const updatePath = (path: URI) => {
		try {
			props.fileService.exists(path).then(exists => {
				setDirectory({
					value: path,
					valid: exists,
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
			updatePath(uri[0]);
		}
	};

	const acceptHandler = async () => {
		if (validateInput()) {
			const filePath = URI.joinPath(directory.value, `${name.value}.${format}`);
			const fileExists = await props.fileService.exists(filePath);
			if (fileExists) {
				const confirmation = await new Promise<boolean>((resolve) => {
					const dialog = props.dialogService.showModalDialogPrompt(
						localize('positron.savePlotModalDialog.fileExists', "The file already exists"),
						localize('positron.savePlotModalDialog.fileExistsMessage', "The file already exists. Do you want to overwrite it?"),
						localize('positron.savePlotModalDialog.overwrite', "Overwrite"),
						localize('positron.savePlotModalDialog.cancel', "Cancel"),
					);
					dialog.onChoice((choice) => {
						resolve(choice);
					});
				});
				if (!confirmation) {
					return;
				}
			}
			setRendering(true);

			generatePreview(format)
				.then(async (plotResult) => {
					props.savePlotCallback({ uri: plotResult.uri, path: filePath });
				})
				.catch((error) => {
					props.notificationService.error(localize('positron.savePlotModalDialog.errorSavingPlot', "Error saving plot: {0}", JSON.stringify(error)));
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
		return props.plotClient.renderWithSizingPolicy(size, dpi.value / BASE_DPI, format, true);
	};

	let intrinsicWidth = '';
	let intrinsicHeight = '';
	if (enableIntrinsicSize && props.plotIntrinsicSize) {
		intrinsicWidth = localize(
			'positron.savePlotModalDialog.width.intrinsicSize',
			"{0}{1}",
			props.plotIntrinsicSize.width,
			formatPlotUnit(props.plotIntrinsicSize.unit),
		);
		intrinsicHeight = localize(
			'positron.savePlotModalDialog.height.intrinsicSize',
			"{0}{1}",
			props.plotIntrinsicSize.height,
			formatPlotUnit(props.plotIntrinsicSize.unit),
		);
	}

	const okButton = (
		<Button className='action-bar-button default' onPressed={acceptHandler}>
			{localize('positron.savePlotModalDialog.save', "Save")}
		</Button>
	);
	const cancelButton = (
		<Button className='action-bar-button' onPressed={cancelHandler}>
			{localize('positronCancel', "Cancel")}
		</Button>
	);

	return (
		<PositronModalDialog
			height={SAVE_PLOT_MODAL_DIALOG_HEIGHT}
			renderer={props.renderer}
			title={(() => localize('positron.savePlotModalDialog.title', "Save Plot"))()}
			width={SAVE_PLOT_MODAL_DIALOG_WIDTH}
			onCancel={cancelHandler}>
			<ContentArea>
				<div className='plot-preview-container'>
					<div className='plot-preview-input'>
						<div className='browse'>
							<LabeledFolderInput
								error={!directory.valid}
								inputRef={inputRef}
								label={(() => localize(
									'positron.savePlotModalDialog.directory',
									"Directory"
								))()}
								readOnlyInput={false}
								value={pathUriToLabel(directory.value, props.labelService)}
								onBrowse={browseHandler}
								onChange={async e => updatePath(
									await combineLabelWithPathUri(
										e.target.value,
										directory.value,
										props.pathService
									)
								)} />
						</div>
						<div className='file'>
							<LabeledTextInput
								error={!name.valid}
								label={(() => localize(
									'positron.savePlotModalDialog.name',
									"Name"
								))()}
								value={name.value}
								onChange={e => setName({ value: e.target.value, valid: !!e.target.value })}
							/>
							<div>
								<label>{(() => localize('positron.savePlotModalDialog.format', "Format"))()}
									<DropDownListBox
										entries={[
											new DropDownListBoxItem<RenderFormat, RenderFormat>({ identifier: RenderFormat.Png, title: RenderFormat.Png.toUpperCase(), value: RenderFormat.Png }),
											new DropDownListBoxItem<RenderFormat, RenderFormat>({ identifier: RenderFormat.Jpeg, title: RenderFormat.Jpeg.toUpperCase(), value: RenderFormat.Jpeg }),
											new DropDownListBoxItem<RenderFormat, RenderFormat>({ identifier: RenderFormat.Svg, title: RenderFormat.Svg.toUpperCase(), value: RenderFormat.Svg }),
											new DropDownListBoxItem<RenderFormat, RenderFormat>({ identifier: RenderFormat.Pdf, title: RenderFormat.Pdf.toUpperCase(), value: RenderFormat.Pdf }),
											new DropDownListBoxItem<RenderFormat, RenderFormat>({ identifier: RenderFormat.Tiff, title: RenderFormat.Tiff.toUpperCase(), value: RenderFormat.Tiff }),
										]}
										keybindingService={props.keybindingService}
										layoutService={props.layoutService}
										selectedIdentifier={format}
										title={(() => localize(
											'positron.savePlotModalDialog.format',
											"Format"
										))()}
										onSelectionChanged={(ext) => { setFormat(ext.options.identifier); }} />
								</label>
							</div>
						</div>
						<div className='plot-input'>
							{enableIntrinsicSize ? <>
								<LabeledTextInput
									disabled={true}
									label={(() => localize(
										'positron.savePlotModalDialog.width',
										"Width"
									))()}
									type={'text'}
									value={intrinsicWidth}
								/>
								<LabeledTextInput
									disabled={true}
									label={(() => localize(
										'positron.savePlotModalDialog.height',
										"Height"
									))()}
									type={'text'}
									value={intrinsicHeight}
								/>
							</> : <>
								<LabeledTextInput
									error={!width.valid}
									label={(() => localize(
										'positron.savePlotModalDialog.width',
										"Width"
									))()}
									min={1}
									type={'number'}
									value={width.value}
									onChange={e => updateWidth(e.target.value)}
								/>
								<LabeledTextInput
									error={!height.valid}
									label={(() => localize(
										'positron.savePlotModalDialog.height',
										"Height"
									))()}
									min={1}
									type={'number'}
									value={height.value}
									onChange={e => updateHeight(e.target.value)}
								/>
							</>}
							{enableDPI && <LabeledTextInput
								error={!dpi.valid}
								label={(() => localize(
									'positron.savePlotModalDialog.dpi',
									"DPI"
								))()}
								max={300}
								min={1}
								type={'number'}
								value={dpi.value}
								onChange={e => updateDpi(e.target.value)}
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
								initialChecked={enableIntrinsicSize}
								label={(() => localize(
									'positron.savePlotModalDialog.useIntrinsicSize',
									"Use intrinsic size"
								))()}
								onChanged={checked => setEnableIntrinsicSize(checked)} /> : null}
						</div>
						<div className='preview-progress'>
							{rendering && <ProgressBar />}
						</div>
						<div className='plot-preview-image-container preview'>
							{(uri &&
								<img alt={props.plotClient.metadata.code} className='plot-preview' src={uri} />)
							}
						</div>
					</div>
				</div>
			</ContentArea>

			<div className='plot-save-dialog-action-bar top-separator'>
				<div className='left'>
					<PositronButton className='action-bar-button' onPressed={updatePreview}>
						{(() => localize('positron.savePlotModalDialog.updatePreview', "Preview"))()}
					</PositronButton>
				</div>
				<div className='right'>
					<PlatformNativeDialogActionBar primaryButton={okButton} secondaryButton={cancelButton} />
				</div>
			</div>

		</PositronModalDialog>
	);
};
