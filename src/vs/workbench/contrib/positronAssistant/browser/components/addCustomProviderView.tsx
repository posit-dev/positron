/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './connectProviderView.css';
import './addCustomProviderView.css';

import { useState } from 'react';

import { localize } from '../../../../../nls.js';
import { IPositronLanguageModelSource } from '../../common/interfaces/positronAssistantService.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
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
 * The Add Custom Provider form.
 *
 * A custom provider is an existing provider reached with a credential of your
 * own, so the form asks for one thing the built-ins don't (the name you'll see
 * in the model picker) and then shows that provider's own fields, read from its
 * registered source. Pick type "Anthropic" and you get Anthropic's inputs, its
 * base URL label, and its terms notice.
 *
 * Interaction rules, matching Posit Assistant standalone:
 *
 * - Field order is name, then type, then the provider's connection fields.
 * - Nothing validates on blur or on change. Problems report on submit, in one
 *   inline message, so the primary button is never greyed out unexplained.
 * - Changing the type rebuilds the form and keeps only the name, so a key typed
 *   for one provider can't be submitted against another.
 */

/**
 * Fields shown when the built-in a kind borrows from isn't registered in this
 * window. Matches the OpenAI-compatible shape, so the form still asks for a key
 * and a URL rather than nothing.
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
	/**
	 * The registered provider sources. Supplies the connection fields, base URL
	 * label, default URL and terms notice of whichever built-in the chosen type
	 * borrows from, and the existing names a new one can't collide with.
	 */
	sources: IPositronLanguageModelSource[];
	/**
	 * Create the entry and store its credential. Rejects with the message the
	 * form shows, so the checks that belong to the writer (reserved names, the
	 * provider's own key check) report here.
	 */
	onCreate: (request: IAddCustomProviderRequest) => Promise<void>;
	/** Invoked by the footer Back button, and after a successful create. */
	onBack: () => void;
	/** Invoked by the footer Close button. */
	onClose: () => void;
}

export const AddCustomProviderView = (props: AddCustomProviderViewProps) => {
	const [name, setName] = useState('');
	const [kind, setKind] = useState<CustomProviderKind>(DEFAULT_CUSTOM_PROVIDER_KIND);
	const [apiKey, setApiKey] = useState('');
	const [baseUrl, setBaseUrl] = useState(() => defaultBaseUrl(props.sources, DEFAULT_CUSTOM_PROVIDER_KIND));
	const [modelIds, setModelIds] = useState<string[]>(['']);
	const [saving, setSaving] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string>();

	// The built-in whose fields this type reuses. Read from its own source so a
	// field added to that tile appears here too.
	const basedOn = props.sources.find(s => s.provider.id === CUSTOM_PROVIDER_KINDS[kind].fieldsFrom);
	const fields = basedOn
		? { showApiKey: usesApiKey(basedOn.supportedOptions), showBaseUrl: basedOn.supportedOptions.includes('baseUrl') }
		: FALLBACK_OPTIONS;

	// Changing the type keeps only the name: the connection fields belong to the
	// provider that was chosen when they were typed. The base URL is re-seeded
	// from the newly chosen provider's own default.
	const changeKind = (next: CustomProviderKind) => {
		setKind(next);
		setApiKey('');
		setBaseUrl(defaultBaseUrl(props.sources, next));
		setModelIds(['']);
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
			// No success screen: the flow returns to the list, where the new
			// provider's own row is the confirmation.
			props.onBack();
		} catch (e) {
			setErrorMessage(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	return (
		<>
			<ContentArea>
				<div className='connect-provider-view add-custom-provider-view' data-testid='provider-add-custom-view'>
					{/* Headed by the vendor it borrows from, so it reads as "another
					Anthropic connection" rather than a generic form set to Anthropic. */}
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

					{/* The chosen provider's own inputs, rendered by the component the
					connect view uses, so they match field for field. */}
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

					{/* Every offered kind publishes a model list, so the rows are an
					override and stay out of the way until asked for. */}
					<ProviderModelsSection
						collapsible
						hint={localize('positron.addCustomProvider.modelsHint', "This provider lists its own models. Add IDs here only to override that list.")}
						modelIds={modelIds}
						onChange={setModelIds}
					/>

					{errorMessage && <ProviderErrorBanner message={errorMessage} />}
					<div style={{ flexGrow: 1 }}>&nbsp;</div>
					{/* The notice belongs to the provider the entry connects to, so
					changing the type changes the terms under the form. */}
					{basedOn && <ProviderNotice source={basedOn} />}
				</div>
			</ContentArea>
			<ProviderModalFooter
				primaryButton={{
					title: saving
						? localize('positron.addCustomProvider.adding', "Adding...")
						: localize('positron.addCustomProvider.add', "Add Provider"),
					// Never gated on the form being complete: submitting is how the
					// user finds out what's missing.
					disable: saving,
					loading: saving,
					onClick: onSubmit,
				}}
				onBack={props.onBack}
				onClose={props.onClose}
			/>
		</>
	);
};

/**
 * The problem with the chosen name, or undefined when it can be submitted.
 *
 * Only the name is checked here. The rest of the form is checked by the writer,
 * which runs the same key check the matching built-in runs and knows the
 * reserved names, so duplicating either would only let the two disagree.
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

/** The base URL the borrowed built-in suggests, if it has one. */
function defaultBaseUrl(sources: IPositronLanguageModelSource[], kind: CustomProviderKind): string {
	const basedOn = sources.find(s => s.provider.id === CUSTOM_PROVIDER_KINDS[kind].fieldsFrom);
	return basedOn?.defaults.baseUrl ?? '';
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
