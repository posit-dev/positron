/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { DropDownListBox } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { RadioGroup } from '../../../../browser/positronComponents/positronModalDialog/components/radioGroup.js';
import { RadioButtonItem } from '../../../../browser/positronComponents/positronModalDialog/components/radioButton.js';
import { PDF_PRESETS, PdfOrientation, PdfPreset } from './pdfPageSize.js';

/**
 * A size field in inches, as typed.
 */
export interface InchField {
	/** The text in the field. */
	text: string;
	/** The value in inches, rounded to two decimals; NaN when the text is not a number. */
	value: number;
	/** Whether the value is a usable size. */
	valid: boolean;
}

/**
 * PdfSizeInputsProps interface.
 */
interface PdfSizeInputsProps {
	preset: PdfPreset;
	orientation: PdfOrientation;
	width: InchField;
	height: InchField;
	onPresetChanged: (preset: PdfPreset) => void;
	onOrientationChanged: (orientation: PdfOrientation) => void;
	onWidthChanged: (text: string) => void;
	onHeightChanged: (text: string) => void;
}

/**
 * Gets the title of a PDF page size preset.
 * @param preset The preset.
 * @returns The localized title.
 */
function presetTitle(preset: PdfPreset): string {
	switch (preset) {
		case 'plotPane': return localize('positron.savePlotModalDialog.pdfPreset.plotPane', "Plot Pane");
		case 'letter': return localize('positron.savePlotModalDialog.pdfPreset.letter', "Letter");
		case 'legal': return localize('positron.savePlotModalDialog.pdfPreset.legal', "Legal");
		case 'a4': return localize('positron.savePlotModalDialog.pdfPreset.a4', "A4");
		case 'a5': return localize('positron.savePlotModalDialog.pdfPreset.a5', "A5");
		case 'a6': return localize('positron.savePlotModalDialog.pdfPreset.a6', "A6");
		case '4x6': return localize('positron.savePlotModalDialog.pdfPreset.4x6', "4 x 6 in");
		case '5x7': return localize('positron.savePlotModalDialog.pdfPreset.5x7', "5 x 7 in");
		case '6x8': return localize('positron.savePlotModalDialog.pdfPreset.6x8', "6 x 8 in");
		case 'custom': return localize('positron.savePlotModalDialog.pdfPreset.custom', "Custom");
	}
}

/**
 * The page size inputs shown when saving a plot as a PDF: the size preset, the orientation,
 * and the width and height in inches.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const PdfSizeInputs = (props: PdfSizeInputsProps) => {
	// The radio button identifiers become element ids, so they are scoped to this instance.
	const idPrefix = React.useId();
	const orientationLabelId = `${idPrefix}-orientation`;
	const landscapeId = `${idPrefix}-landscape`;
	const portraitId = `${idPrefix}-portrait`;

	const presetEntries = React.useMemo(() => PDF_PRESETS.map(preset =>
		new DropDownListBoxItem<PdfPreset, PdfPreset>({ identifier: preset, title: presetTitle(preset), value: preset })
	), []);

	const orientationEntries = [
		new RadioButtonItem({
			identifier: landscapeId,
			title: localize('positron.savePlotModalDialog.landscape', "Landscape"),
		}),
		new RadioButtonItem({
			identifier: portraitId,
			title: localize('positron.savePlotModalDialog.portrait', "Portrait"),
		}),
	];

	const inchesSuffix = localize('positron.savePlotModalDialog.inches', "in");

	return (
		<>
			<div className='pdf-size'>
				<label>{localize('positron.savePlotModalDialog.size', "Size")}
					<DropDownListBox
						entries={presetEntries}
						selectedIdentifier={props.preset}
						title={localize('positron.savePlotModalDialog.size', "Size")}
						onSelectionChanged={item => props.onPresetChanged(item.options.identifier)} />
				</label>
			</div>
			<div className='pdf-orientation'>
				<span id={orientationLabelId}>{localize('positron.savePlotModalDialog.orientation', "Orientation")}</span>
				<RadioGroup
					entries={orientationEntries}
					initialSelectionId={props.orientation === 'landscape' ? landscapeId : portraitId}
					labelledBy={orientationLabelId}
					name={orientationLabelId}
					onSelectionChanged={id => props.onOrientationChanged(id === landscapeId ? 'landscape' : 'portrait')} />
			</div>
			<div className='pdf-inches'>
				<LabeledTextInput
					error={!props.width.valid}
					label={localize('positron.savePlotModalDialog.width', "Width")}
					min={0.01}
					step={0.01}
					type={'number'}
					value={props.width.text}
					onChange={e => props.onWidthChanged(e.target.value)}
				/>
				<LabeledTextInput
					error={!props.height.valid}
					label={localize('positron.savePlotModalDialog.height', "Height")}
					min={0.01}
					step={0.01}
					type={'number'}
					value={props.height.text}
					onChange={e => props.onHeightChanged(e.target.value)}
				/>
				<span className='unit'>{inchesSuffix}</span>
			</div>
		</>
	);
};
