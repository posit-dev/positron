/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './connectProviderView.css';
import './addCustomProviderView.css';

import { useState } from 'react';

import { localize } from '../../../../../nls.js';
import { IPositronLanguageModelSource } from '../../common/interfaces/positronAssistantService.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { DropDownListBox, DropDownListBoxEntry } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { DropDownListBoxSeparator } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBoxSeparator.js';
import { LanguageModelIcon } from './languageModelButton.js';
import { ProviderErrorBanner, ProviderNotice } from './connectProviderView.js';
import { ProviderConnectionFields, usesApiKey } from './providerConnectionFields.js';
import { ProviderModelsSection } from './providerModelsSection.js';
import { ProviderModalFooter } from './providerModalFooter.js';
import { IAddCustomProviderRequest } from '../customProviderCommands.js';
import {
	CUSTOM_PROVIDER_GROUP_ORDER,
	CUSTOM_PROVIDER_KINDS,
	CustomProviderKind,
	customProviderGroupLabel,
	customProviderKindsInGroup,
	DEFAULT_CUSTOM_PROVIDER_KIND,
} from '../customProviderKinds.js';

/**
 * The Add Custom Provider form. A custom provider is an existing provider
 * reached with a credential of your own, so the form asks for a name and then
 * shows that provider's own fields, read from its registered source. Field
 * behaviour matches Posit Assistant standalone.
 */

/**
 * Fields shown when the built-in a kind borrows from isn't registered in this
 * window, so the form still asks for a key and a URL rather than nothing.
 */
const FALLBACK_OPTIONS = { showApiKey: true, showBaseUrl: true };

/** Identifier prefix for the non-selectable group heading rows. */
const GROUP_HEADING_PREFIX = 'group:';

/** What a type-picker row carries: its label, and whether it's a group heading. */
interface KindEntryValue {
	label: string;
	heading?: boolean;
}

export interface AddCustomProviderViewProps {
	/** The renderer this view draws its dialog box into. */
	renderer: PositronModalReactRenderer;
	/** The dialog title, computed by the modal so every view titles itself the same way. */
	title: string;
	/** The dialog width, set by the modal so every view is the same size. */
	width: number;
	/**
	 * The registered provider sources: the connection fields, labels and terms
	 * notice of the built-in the chosen type borrows from, and the existing names
	 * a new one can't collide with.
	 */
	sources: IPositronLanguageModelSource[];
	/**
	 * Create the entry and store its credential. Rejects with the message the
	 * form shows, which is how the writer's own checks report.
	 */
	onCreate: (request: IAddCustomProviderRequest) => Promise<void>;
	/** Invoked by the footer Back button, and after a successful create. */
	onBack: () => void;
}

export const AddCustomProviderView = (props: AddCustomProviderViewProps) => {
	const [name, setName] = useState('');
	const [kind, setKind] = useState<CustomProviderKind>(DEFAULT_CUSTOM_PROVIDER_KIND);
	const [apiKey, setApiKey] = useState('');
	const [baseUrl, setBaseUrl] = useState('');
	const [modelIds, setModelIds] = useState<string[]>(['']);
	const [saving, setSaving] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string>();

	// The built-in whose fields this type reuses, read from its own source.
	const basedOn = props.sources.find(s => s.provider.id === CUSTOM_PROVIDER_KINDS[kind].fieldsFrom);
	const fields = basedOn
		? { showApiKey: usesApiKey(basedOn.supportedOptions), showBaseUrl: basedOn.supportedOptions.includes('baseUrl') }
		: FALLBACK_OPTIONS;

	// Only the stale error goes; it was reported against the old type.
	const changeKind = (next: CustomProviderKind) => {
		setKind(next);
		setErrorMessage(undefined);
	};

	const onSubmit = async () => {
		const trimmedName = name.trim();
		const problem = nameProblem(trimmedName, props.sources);
		setErrorMessage(problem);
		if (problem) {
			return;
		}

		setSaving(true);
		try {
			await props.onCreate({
				name: trimmedName,
				kind,
				baseUrl: fields.showBaseUrl ? baseUrl.trim() : undefined,
				apiKey: fields.showApiKey ? apiKey : undefined,
				modelIds: modelIds.map(id => id.trim()).filter(id => id.length > 0),
			});
			// No success screen: the new provider's own row is the confirmation.
			props.onBack();
		} catch (e) {
			setErrorMessage(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	return (
		<PositronDynamicModalDialog
			content={
				<div className='connect-provider-view add-custom-provider-view' data-testid='provider-add-custom-view'>
					{/* Headed by the vendor it borrows from, so it reads as "another
					Anthropic connection" rather than a form set to Anthropic. */}
					<div className='connect-provider-header'>
						<div className='connect-provider-icon'>
							<LanguageModelIcon
								logoUrl={basedOn?.provider.logoUrl}
								provider={CUSTOM_PROVIDER_KINDS[kind].fieldsFrom}
							/>
						</div>
						<div className='connect-provider-header-text'>
							<span className='connect-provider-name'>
								{name.trim() || localize(
									'positron.addCustomProvider.newProvider',
									"New {0} provider",
									CUSTOM_PROVIDER_KINDS[kind].label
								)}
							</span>
							<span className='connect-provider-subtitle'>
								{localize(
									'positron.addCustomProvider.basedOn',
									"Same connection settings as the built-in {0} provider",
									CUSTOM_PROVIDER_KINDS[kind].label
								)}
							</span>
						</div>
					</div>

					<div className='connect-provider-apikey'>
						<label className='connect-provider-apikey-label' htmlFor='add-custom-provider-name-input'>
							{localize('positron.addCustomProvider.nameLabel', "Provider Name")}
						</label>
						<input
							autoComplete='off'
							className='connect-provider-apikey-input'
							id='add-custom-provider-name-input'
							placeholder={localize('positron.addCustomProvider.namePlaceholder', "My Gateway")}
							spellCheck={false}
							type='text'
							value={name}
							onChange={e => setName(e.target.value)}
						/>
						{/* Rename is delete-and-re-add, so say so before they commit. */}
						<p className='connect-provider-models-hint'>
							{localize('positron.addCustomProvider.nameHint', "Shown in the model picker. It cannot be changed later.")}
						</p>

						<label className='connect-provider-apikey-label' id='add-custom-provider-type-label'>
							{localize('positron.addCustomProvider.typeLabel', "Provider Type")}
						</label>
						<DropDownListBox
							className='add-custom-provider-type'
							createItem={item => <KindEntry value={item.options.value} />}
							entries={kindEntries()}
							selectedIdentifier={kind}
							title={localize('positron.addCustomProvider.typePlaceholder', "Select Provider Type")}
							onSelectionChanged={item => {
								if (!item.options.identifier.startsWith(GROUP_HEADING_PREFIX)) {
									changeKind(item.options.identifier as CustomProviderKind);
								}
							}}
						/>
					</div>

					{/* The same component the connect view renders, field for field. */}
					<ProviderConnectionFields
						apiKey={apiKey}
						baseUrl={baseUrl}
						idPrefix='add-custom-provider'
						providerId={CUSTOM_PROVIDER_KINDS[kind].fieldsFrom}
						showApiKey={fields.showApiKey}
						showBaseUrl={fields.showBaseUrl}
						onApiKeyChange={setApiKey}
						onBaseUrlChange={setBaseUrl}
					/>

					{/* Every offered kind publishes a model list, so these are an
					override and stay collapsed until asked for. */}
					<ProviderModelsSection
						collapsible
						hint={localize('positron.addCustomProvider.modelsHint', "This provider lists its own models. Add IDs here only to override that list.")}
						modelIds={modelIds}
						onChange={setModelIds}
					/>

					{errorMessage && <ProviderErrorBanner message={errorMessage} />}
					<div style={{ flexGrow: 1 }}>&nbsp;</div>
					{/* The terms belong to the provider the entry connects to. */}
					{basedOn && <ProviderNotice source={basedOn} />}
				</div>
			}
			footer={
				<ProviderModalFooter
					primaryButton={{
						title: saving
							? localize('positron.addCustomProvider.adding', "Adding...")
							: localize('positron.addCustomProvider.add', "Add Provider"),
						// Never gated on completeness: submitting is how the user finds
						// out what's missing.
						disable: saving,
						loading: saving,
						onClick: onSubmit,
					}}
					onBack={props.onBack}
				/>
			}
			renderer={props.renderer}
			title={props.title}
			width={props.width}
			onCancel={() => props.renderer.dispose()}
		/>
	);
};

/**
 * The problem with the chosen name, or undefined when it can be submitted. Only
 * the name is checked here; the writer checks the rest, and duplicating its
 * reserved names or key check would only let the two disagree.
 */
function nameProblem(name: string, sources: IPositronLanguageModelSource[]): string | undefined {
	if (!name) {
		return localize('positron.addCustomProvider.error.nameRequired', "Enter a name for this provider.");
	}
	const taken = sources.some(s =>
		s.provider.id.toLowerCase() === name.toLowerCase() ||
		s.provider.displayName.toLowerCase() === name.toLowerCase()
	);
	if (taken) {
		return localize('positron.addCustomProvider.error.nameTaken', "There is already a provider named \"{0}\". Choose another name.", name);
	}
	return undefined;
}

/** The grouped type-picker entries: a disabled heading per group, then its kinds. */
function kindEntries(): DropDownListBoxEntry<string, KindEntryValue>[] {
	const entries: DropDownListBoxEntry<string, KindEntryValue>[] = [];
	for (const group of CUSTOM_PROVIDER_GROUP_ORDER) {
		const kinds = customProviderKindsInGroup(group);
		if (kinds.length === 0) {
			continue;
		}
		if (entries.length > 0) {
			entries.push(new DropDownListBoxSeparator());
		}
		entries.push(new DropDownListBoxItem<string, KindEntryValue>({
			identifier: `${GROUP_HEADING_PREFIX}${group}`,
			disabled: true,
			value: { label: customProviderGroupLabel(group), heading: true },
		}));
		for (const kind of kinds) {
			entries.push(new DropDownListBoxItem<string, KindEntryValue>({
				identifier: kind,
				value: { label: CUSTOM_PROVIDER_KINDS[kind].label },
			}));
		}
	}
	return entries;
}

/** One type-picker row: either a group heading or a selectable kind. */
const KindEntry = (props: { value: KindEntryValue }) => (
	<span className={props.value.heading ? 'add-custom-provider-type-heading' : 'add-custom-provider-type-label'}>
		{props.value.label}
	</span>
);
