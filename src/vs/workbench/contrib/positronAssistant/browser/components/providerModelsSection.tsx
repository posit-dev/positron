/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './connectProviderView.css';

import { useState } from 'react';

import { localize } from '../../../../../nls.js';

export interface ProviderModelsSectionProps {
	/** One entry per row, including the blank ones. */
	modelIds: string[];
	onChange: (modelIds: string[]) => void;
	/**
	 * Collapse the rows behind a "Models" toggle, for a provider that lists its
	 * own and needs these only as an override. Left open for one with no listing.
	 */
	collapsible?: boolean;
	/** Explains why the rows are here. Defaults to the "no listing" wording. */
	hint?: string;
	/** Offers providers.json for what this form doesn't cover. */
	onEditRawConfig?: () => void;
}

/**
 * The model id rows, for the connect form and the Add Custom Provider form. A
 * user declares ids when the endpoint has no `/models` listing, the gateway
 * case; one that publishes a listing needs nothing here.
 */
export const ProviderModelsSection = (props: ProviderModelsSectionProps) => {
	const [open, setOpen] = useState(false);

	const setModelIdAt = (index: number, value: string) =>
		props.onChange(props.modelIds.map((v, i) => i === index ? value : v));
	const addModelRow = () => props.onChange([...props.modelIds, '']);
	const removeModelRow = (index: number) => props.onChange(props.modelIds.filter((_, i) => i !== index));

	const hint = props.hint ?? localize(
		'positron.connectProvider.modelsHint',
		"List the model IDs this provider serves. Add these when the provider has no model listing of its own."
	);

	const rows = (
		<>
			<p className='connect-provider-models-hint'>{hint}</p>
			{props.modelIds.map((id, index) => (
				<div key={index} className='connect-provider-model-row'>
					<input
						autoComplete='off'
						className='connect-provider-apikey-input'
						placeholder={localize('positron.connectProvider.modelIdPlaceholder', "Model ID")}
						spellCheck={false}
						type='text'
						value={id}
						onChange={e => setModelIdAt(index, e.target.value)}
					/>
					<button
						className='connect-provider-model-remove'
						title={localize('positron.connectProvider.removeModel', "Remove Model")}
						type='button'
						onClick={() => removeModelRow(index)}
					>
						<span aria-hidden='true' className='codicon codicon-trash' />
					</button>
				</div>
			))}
			<button className='connect-provider-add-model' type='button' onClick={addModelRow}>
				<span aria-hidden='true' className='codicon codicon-add' />
				{localize('positron.connectProvider.addModel', "Add Model")}
			</button>
			{props.onEditRawConfig &&
				<button className='connect-provider-edit-json' type='button' onClick={props.onEditRawConfig}>
					{localize('positron.connectProvider.editJson', "Edit providers.json for advanced options (closes this dialog)")}
				</button>
			}
		</>
	);

	if (!props.collapsible) {
		return (
			<div className='connect-provider-models' data-testid='provider-models-section'>
				<label className='connect-provider-apikey-label'>
					{localize('positron.connectProvider.modelsLabel', "Models")}
				</label>
				{rows}
			</div>
		);
	}

	// So a declared list is visible without opening the section.
	const declared = props.modelIds.filter(id => id.trim().length > 0).length;

	return (
		<div className='connect-provider-disclosure' data-testid='provider-models-section'>
			<button
				aria-expanded={open}
				className='connect-provider-disclosure-summary'
				type='button'
				onClick={() => setOpen(!open)}
			>
				<span aria-hidden='true' className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} />
				{localize('positron.connectProvider.modelsLabel', "Models")}
				<span className='connect-provider-disclosure-count'>
					{declared > 0
						? localize('positron.connectProvider.modelsCount', "({0})", declared)
						: localize('positron.connectProvider.modelsOptional', "(optional)")}
				</span>
			</button>
			{open && <div className='connect-provider-disclosure-body'>{rows}</div>}
		</div>
	);
};
