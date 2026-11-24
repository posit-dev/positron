/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './savePlotModalDialog.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { URI } from '../../../../../base/common/uri.js';
import { ProgressBar } from '../../../../../base/browser/ui/positronComponents/progressBar.js';
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { LabeledFolderInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledFolderInput.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PlatformNativeDialogActionBar } from '../../../../browser/positronComponents/positronModalDialog/components/platformNativeDialogActionBar.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { FileFilter } from 'electron';
import { DropDownListBox } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { IntrinsicSize } from '../../../../services/languageRuntime/common/positronPlotComm.js';
import { Checkbox } from '../../../../browser/positronComponents/positronModalDialog/components/checkbox.js';
import { IPlotSize, IPositronPlotSizingPolicy } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { formatPlotUnit, PlotSizingPolicyIntrinsic } from '../../../../services/positronPlots/common/sizingPolicyIntrinsic.js';
import { combineLabelWithPathUri, pathUriToLabel } from '../../../../browser/utils/path.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { PlotRenderFormat } from '../../../../services/positronPlots/common/positronPlots.js';
import { IRenderedPlot } from '../../../../services/languageRuntime/common/positronPlotRenderQueue.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { intrinsicSizeInPixels, linkedHeight, linkedWidth, ratioOf } from './aspectRatioLock.js';
import { defaultSaveResolution, isRasterFormat, normalizeSaveResolutions, SaveResolutionsConfigKey } from './saveResolution.js';
import * as DOM from '../../../../../base/browser/dom.js';

export interface SavePlotOptions {
	uri: string;
	path: URI;
	format?: PlotRenderFormat;
	/** The resolution the plot was saved at; undefined for vector formats. */
	resolution?: number;
	/**
	 * Whether the user picked the resolution, rather than keeping the dialog's default. Only a
	 * picked resolution should be remembered: a default comes from the screen the dialog opened
	 * on, so remembering it would carry a 1x save on a 1x monitor over to a 2x screen.
	 */
	resolutionPicked?: boolean;
}

const SAVE_PLOT_MODAL_DIALOG_WIDTH = 500;
const SAVE_PLOT_MODAL_DIALOG_HEIGHT = 600;
export const BASE_DPI = 100; // matplotlib default DPI, used to show an intrinsic size in inches as pixels

/**
 * Show the save plot modal dialog for dynamic plots.
 * @param selectedSizingPolicy the selected sizing policy for the plot
 * @param plotClient the dynamic plot client to render previews and the final image
 * @param savePlotCallback the action to take when the dialog closes
 * @param suggestedPath the pre-filled save path
 * @param suggestedFormat the pre-selected format
 * @param suggestedResolution the pre-selected resolution for raster formats, if it is still offered
 */
export const showSavePlotModalDialog = (
	selectedSizingPolicy: IPositronPlotSizingPolicy,
	plotClient: PlotClientInstance,
	savePlotCallback: (options: SavePlotOptions) => void,
	suggestedPath?: URI,
	suggestedFormat?: PlotRenderFormat,
	suggestedResolution?: number,
) => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer();

	renderer.render(
		<SavePlotModalDialog
			enableIntrinsicSize={selectedSizingPolicy instanceof PlotSizingPolicyIntrinsic && !!plotClient.intrinsicSize}
			plotClient={plotClient}
			plotIntrinsicSize={plotClient.intrinsicSize}
			plotSize={plotClient.lastRender?.size}
			renderer={renderer}
			savePlotCallback={savePlotCallback}
			suggestedFormat={suggestedFormat}
			suggestedPath={suggestedPath}
			suggestedResolution={suggestedResolution}
		/>
	);
};

interface SavePlotModalDialogProps {
	renderer: PositronModalReactRenderer;
	enableIntrinsicSize: boolean;
	plotSize: IPlotSize | undefined;
	plotIntrinsicSize: IntrinsicSize | undefined;
	plotClient: PlotClientInstance;
	savePlotCallback: (options: SavePlotOptions) => void;
	suggestedPath?: URI;
	suggestedFormat?: PlotRenderFormat;
	suggestedResolution?: number;
}

interface DirectoryState {
	value: URI;
	valid: boolean;
	errorMessage?: string;
}

const SavePlotModalDialog = (props: SavePlotModalDialogProps) => {
	const [directory, setDirectory] = React.useState<DirectoryState>({ value: props.suggestedPath ?? URI.file(''), valid: true });
	const [name, setName] = React.useState({ value: props.plotClient.metadata.name ?? props.plotClient.metadata.suggested_file_name ?? 'plot', valid: true });
	const [format, setFormat] = React.useState(props.suggestedFormat ?? PlotRenderFormat.Png);
	const [enableIntrinsicSize, setEnableIntrinsicSize] = React.useState(props.enableIntrinsicSize);
	// The plot's last render size, or its intrinsic size when it has not rendered at a size,
	// as it hasn't under the Intrinsic sizing policy.
	const [initialSize] = React.useState(() => props.plotSize ??
		(props.plotIntrinsicSize ? intrinsicSizeInPixels(props.plotIntrinsicSize, BASE_DPI) : undefined));
	const [width, setWidth] = React.useState({ value: initialSize?.width ?? 100, valid: true });
	const [height, setHeight] = React.useState({ value: initialSize?.height ?? 100, valid: true });
	// The resolutions offered for raster formats, and the one chosen. The default is never less
	// sharp than the Plots pane, which renders at the screen's pixel density.
	const [resolutions] = React.useState(() => normalizeSaveResolutions(
		props.renderer.services.configurationService.getValue(SaveResolutionsConfigKey)));
	const [resolution, setResolution] = React.useState(() => defaultSaveResolution(
		resolutions, DOM.getActiveWindow().devicePixelRatio, props.suggestedResolution));
	// Whether the user picked a resolution, rather than keeping the default.
	const [resolutionPicked, setResolutionPicked] = React.useState(false);
	// The aspect ratio (width / height) kept while editing the size, or undefined when unlocked.
	// Locked by default when the plot has a known size to take the ratio from.
	const [lockedRatio, setLockedRatio] = React.useState<number | undefined>(
		() => initialSize ? ratioOf(initialSize.width, initialSize.height) : undefined
	);
	const [uri, setUri] = React.useState('');
	const [rendering, setRendering] = React.useState(false);
	const inputRef = React.useRef<HTMLInputElement>(null!);

	const filterEntries: FileFilter[] = [];
	for (const filter in PlotRenderFormat) {
		filterEntries.push({ extensions: [filter.toLowerCase()], name: filter.toUpperCase() });
	}

	React.useEffect(() => {
		setUri(props.plotClient.lastRender?.uri ?? '');
	}, [props.plotClient.lastRender?.uri]);

	const validateInput = React.useCallback((): boolean => {
		return directory.valid && width.valid && height.valid && name.valid;
	}, [directory, width, height, name]);

	React.useEffect(() => {
		validateInput();
	}, [validateInput]);

	const updateWidth = (widthString: string): void => {
		const newWidth = parseInt(widthString);
		const valid = newWidth > 0 && !isNaN(newWidth);
		setWidth({ value: newWidth, valid });
		if (lockedRatio !== undefined && valid) {
			setHeight({ value: linkedHeight(newWidth, lockedRatio), valid: true });
		}
	};

	const updateHeight = (heightString: string): void => {
		const newHeight = parseInt(heightString);
		const valid = newHeight > 0 && !isNaN(newHeight);
		setHeight({ value: newHeight, valid });
		if (lockedRatio !== undefined && valid) {
			setWidth({ value: linkedWidth(newHeight, lockedRatio), valid: true });
		}
	};

	// The ratio a new lock would capture from the current size, if both fields are valid.
	const currentRatio = width.valid && height.valid ? ratioOf(width.value, height.value) : undefined;

	const maintainAspectRatio = (checked: boolean): void => {
		setLockedRatio(checked ? currentRatio : undefined);
	};

	const updatePath = (path: URI) => {
		try {
			props.renderer.services.fileService.exists(path).then(exists => {
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
		const uri = await props.renderer.services.fileDialogService.showOpenDialog({
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
			const fileExists = await props.renderer.services.fileService.exists(filePath);
			if (fileExists) {
				const confirmation = await new Promise<boolean>((resolve) => {
					const dialog = props.renderer.services.positronModalDialogsService.showModalDialogPrompt(
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
					props.savePlotCallback({
						uri: plotResult.uri,
						path: filePath,
						format,
						resolution: isRasterFormat(format) ? resolution : undefined,
						resolutionPicked,
					});
				})
				.catch((error) => {
					props.renderer.services.notificationService.error(localize('positron.savePlotModalDialog.errorSavingPlot', "Error saving plot: {0}", JSON.stringify(error)));
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
			// The preview is always a PNG; render it at the resolution the chosen format will be saved at.
			const plotResult = await generatePreview(PlotRenderFormat.Png, isRasterFormat(format) ? resolution : 1);
			setUri(plotResult.uri);
		} catch (error) {
			props.renderer.services.logService.error('Error rendering plot:', error);
		} finally {
			setRendering(false);
		}
	};

	const generatePreview = async (
		format: PlotRenderFormat,
		pixelRatio = isRasterFormat(format) ? resolution : 1,
	): Promise<IRenderedPlot> => {
		let size: IPlotSize | undefined;
		if (!enableIntrinsicSize) {
			if (!width.value || !height.value) {
				throw new Error('Width and height must be defined for plots that do not support intrinsic size.');
			}
			size = { height: height.value, width: width.value };
		}
		// Render at exactly the requested size. The Plots pane's sizing policy
		// governs the pane, not an export the user sized explicitly. Vector formats
		// always render at 1: a larger pixel ratio would enlarge the page, not sharpen it.
		return props.plotClient.render(size, pixelRatio, format, true);
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
			title={localize('positron.savePlotModalDialog.title', "Save Plot")}
			width={SAVE_PLOT_MODAL_DIALOG_WIDTH}
			onCancel={cancelHandler}>
			<ContentArea>
				<div className='plot-preview-container'>
					<div className='plot-preview-input'>
						<div className='browse'>
							<LabeledFolderInput
								error={!directory.valid}
								inputRef={inputRef}
								label={localize(
									'positron.savePlotModalDialog.directory',
									"Directory"
								)}
								readOnlyInput={false}
								value={pathUriToLabel(directory.value, props.renderer.services.labelService)}
								onBrowse={browseHandler}
								onChange={async e => updatePath(
									await combineLabelWithPathUri(
										e.target.value,
										directory.value,
										props.renderer.services.pathService
									)
								)} />
						</div>
						<div className='file'>
							<LabeledTextInput
								error={!name.valid}
								label={localize(
									'positron.savePlotModalDialog.name',
									"Name"
								)}
								value={name.value}
								onChange={e => setName({ value: e.target.value, valid: !!e.target.value })}
							/>
							<div>
								<label>{localize('positron.savePlotModalDialog.format', "Format")}
									<DropDownListBox
										entries={[
											new DropDownListBoxItem<PlotRenderFormat, PlotRenderFormat>({ identifier: PlotRenderFormat.Png, title: PlotRenderFormat.Png.toUpperCase(), value: PlotRenderFormat.Png }),
											new DropDownListBoxItem<PlotRenderFormat, PlotRenderFormat>({ identifier: PlotRenderFormat.Jpeg, title: PlotRenderFormat.Jpeg.toUpperCase(), value: PlotRenderFormat.Jpeg }),
											new DropDownListBoxItem<PlotRenderFormat, PlotRenderFormat>({ identifier: PlotRenderFormat.Svg, title: PlotRenderFormat.Svg.toUpperCase(), value: PlotRenderFormat.Svg }),
											new DropDownListBoxItem<PlotRenderFormat, PlotRenderFormat>({ identifier: PlotRenderFormat.Pdf, title: PlotRenderFormat.Pdf.toUpperCase(), value: PlotRenderFormat.Pdf }),
											new DropDownListBoxItem<PlotRenderFormat, PlotRenderFormat>({ identifier: PlotRenderFormat.Tiff, title: PlotRenderFormat.Tiff.toUpperCase(), value: PlotRenderFormat.Tiff }),
										]}
										selectedIdentifier={format}
										title={localize(
											'positron.savePlotModalDialog.format',
											"Format"
										)}
										onSelectionChanged={(ext) => { setFormat(ext.options.identifier); }} />
								</label>
							</div>
						</div>
						<div className='plot-input'>
							{enableIntrinsicSize ? <>
								<LabeledTextInput
									disabled={true}
									label={localize(
										'positron.savePlotModalDialog.width',
										"Width"
									)}
									type={'text'}
									value={intrinsicWidth}
								/>
								<LabeledTextInput
									disabled={true}
									label={localize(
										'positron.savePlotModalDialog.height',
										"Height"
									)}
									type={'text'}
									value={intrinsicHeight}
								/>
							</> : <>
								<LabeledTextInput
									error={!width.valid}
									label={localize(
										'positron.savePlotModalDialog.width',
										"Width"
									)}
									min={1}
									type={'number'}
									value={width.value}
									onChange={e => updateWidth(e.target.value)}
								/>
								<LabeledTextInput
									error={!height.valid}
									label={localize(
										'positron.savePlotModalDialog.height',
										"Height"
									)}
									min={1}
									type={'number'}
									value={height.value}
									onChange={e => updateHeight(e.target.value)}
								/>
							</>}
							{isRasterFormat(format) && <div className='resolution'>
								<label>{localize('positron.savePlotModalDialog.resolution', "Resolution")}
									<DropDownListBox
										entries={resolutions.map(r => new DropDownListBoxItem<number, number>({
											identifier: r,
											title: localize('positron.savePlotModalDialog.resolutionMultiplier', "{0}x", r),
											value: r,
										}))}
										selectedIdentifier={resolution}
										title={localize('positron.savePlotModalDialog.resolution', "Resolution")}
										onSelectionChanged={item => {
											setResolution(item.options.identifier);
											setResolutionPicked(true);
										}} />
								</label>
							</div>}
							<div className='error'>
								<div>
									{!directory.valid && localize(
										'positron.savePlotModalDialog.invalidPathError',
										"Invalid path: {0}", directory.errorMessage
									)}
								</div>
								<div>
									{(!width.valid || !height.valid) && localize(
										'positron.savePlotModalDialog.dimensionError',
										"Width and height must be greater than 0."
									)}
								</div>
								<div>
									{!name.valid && localize(
										'positron.savePlotModalDialog.invalidNameError',
										"Plot name cannot be empty."
									)}
								</div>
							</div>
						</div>
						<div className='size-options'>
							<Checkbox
								disabled={enableIntrinsicSize || (lockedRatio === undefined && currentRatio === undefined)}
								initialChecked={lockedRatio !== undefined}
								label={localize(
									'positron.savePlotModalDialog.maintainAspectRatio',
									"Maintain aspect ratio"
								)}
								onChanged={maintainAspectRatio} />
							{props.plotIntrinsicSize ? <Checkbox
								initialChecked={enableIntrinsicSize}
								label={localize(
									'positron.savePlotModalDialog.useIntrinsicSize',
									"Use intrinsic size"
								)}
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
					<Button className='action-bar-button' onPressed={updatePreview}>
						{localize('positron.savePlotModalDialog.updatePreview', "Preview")}
					</Button>
				</div>
				<div className='right'>
					<PlatformNativeDialogActionBar primaryButton={okButton} secondaryButton={cancelButton} />
				</div>
			</div>

		</PositronModalDialog>
	);
};
