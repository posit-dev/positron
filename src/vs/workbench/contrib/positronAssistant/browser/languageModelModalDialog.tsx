/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './languageModelModalDialog.css';

// React.
import React, { useEffect } from 'react';

// Other dependencies.
import { PositronModalReactRenderer } from '../../../browser/positronModalReactRenderer/positronModalReactRenderer.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { OKCancelModalDialog } from '../../../browser/positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { VerticalStack } from '../../../browser/positronComponents/positronModalDialog/components/verticalStack.js';
import { DropDownListBox } from '../../../browser/positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../../../browser/positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { LabeledTextInput } from '../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { IPositronLanguageModelConfig, IPositronLanguageModelSource, PositronLanguageModelType } from '../common/interfaces/positronAssistantService.js';
import { localize } from '../../../../nls.js';

export const showLanguageModelModalDialog = (
	keybindingService: IKeybindingService,
	layoutService: ILayoutService,
	sources: IPositronLanguageModelSource[],
	onSave: (config: IPositronLanguageModelConfig) => void,
	onCancel: () => void,
) => {
	const renderer = new PositronModalReactRenderer({
		keybindingService: keybindingService,
		layoutService: layoutService,
		container: layoutService.activeContainer
	});

	renderer.render(
		<div className='language-model-modal-dialog'>
			<LanguageModelConfiguration
				renderer={renderer}
				keybindingService={keybindingService}
				layoutService={layoutService}
				sources={sources}
				onSave={onSave}
				onCancel={onCancel}
			/>
		</div>
	);
};

interface LanguageModelConfigurationProps {
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	sources: IPositronLanguageModelSource[];
	renderer: PositronModalReactRenderer;
	onSave: (config: IPositronLanguageModelConfig) => void;
	onCancel: () => void;
}

const LanguageModelConfiguration = (props: React.PropsWithChildren<LanguageModelConfigurationProps>) => {
	const [type, setType] = React.useState<PositronLanguageModelType>(PositronLanguageModelType.Chat);

	const defaultSource = props.sources.find(source => {
		const defaultProvider = type === 'chat' ? 'anthropic' : 'mistral';
		return source.provider.id === defaultProvider && source.type.includes(type);
	})!;

	const [source, setSource] = React.useState<IPositronLanguageModelSource>(defaultSource);
	const [apiKey, setApiKey] = React.useState<string>();
	const [baseUrl, setBaseUrl] = React.useState<string | undefined>(defaultSource.defaults.baseUrl);
	const [resourceName, setResourceName] = React.useState<string | undefined>(defaultSource.defaults.resourceName);
	const [project, setProject] = React.useState<string | undefined>(defaultSource.defaults.project);
	const [location, setLocation] = React.useState<string | undefined>(defaultSource.defaults.location);
	const [toolCalls, setToolCalls] = React.useState<boolean | undefined>(defaultSource.defaults.toolCalls);
	const [numCtx, setNumCtx] = React.useState<number | undefined>(defaultSource.defaults.numCtx);
	const [model, setModel] = React.useState<string>(defaultSource.defaults.model);
	const [name, setName] = React.useState<string>(defaultSource.defaults.name);

	useEffect(() => {
		setSource(defaultSource);
	}, [type, defaultSource]);

	useEffect(() => {
		setModel(source.defaults.model);
		setName(source.defaults.name);
		setApiKey(source.defaults.apiKey);
		setBaseUrl(source.defaults.baseUrl);
		setResourceName(source.defaults.resourceName);
		setProject(source.defaults.project);
		setLocation(source.defaults.location);
		setToolCalls(source.defaults.toolCalls);
		setNumCtx(source.defaults.numCtx);
	}, [source]);

	const providers = props.sources
		.filter(source => source.type === type)
		.sort((a, b) => a.provider.displayName.localeCompare(b.provider.displayName))
		.map(source => new DropDownListBoxItem({
			identifier: source.provider.id,
			title: source.provider.displayName,
			value: source,
		}))

	const onAccept = async () => {
		if (!source) {
			return;
		}
		props.onSave({
			type: type,
			provider: source.provider.id,
			model: model,
			name: name,
			apiKey: apiKey,
			baseUrl: baseUrl,
			resourceName: resourceName,
			project: project,
			location: location,
			toolCalls: toolCalls,
			numCtx: numCtx,
		})
		props.renderer.dispose();
	}
	const onCancel = async () => {
		props.onCancel();
		props.renderer.dispose();
	}

	return <OKCancelModalDialog
		renderer={props.renderer}
		width={540}
		height={540}
		title={(() => localize('positron.languageModelModalDialog.title', "Add a Language Model Provider"))()}
		okButtonTitle={(() => localize('positron.languageModelModalDialog.save', "Save"))()}
		cancelButtonTitle={(() => localize('positron.languageModelModalDialog.cancel', "Cancel"))()}
		onAccept={onAccept}
		onCancel={onCancel}
	>
		<VerticalStack>
			<label>
				{(() => localize('positron.newConnectionModalDialog.type', "Type"))()}
				<DropDownListBox<string, PositronLanguageModelType>
					onSelectionChanged={(item) => setType(item.options.value)}
					keybindingService={props.keybindingService}
					layoutService={props.layoutService}
					title={(() => localize('positron.newConnectionModalDialog.selectType', "SelectType"))()}
					entries={[
						new DropDownListBoxItem({
							identifier: 'chat',
							title: (() => localize('positron.newConnectionModalDialog.chat', "Chat"))(),
							value: 'chat',
						}),
						new DropDownListBoxItem({
							identifier: 'completion',
							title: (() => localize('positron.newConnectionModalDialog.completion', "Completion"))(),
							value: 'completion',
						})
					]}
					selectedIdentifier={type}
				/>
			</label>
			<label>
				{(() => localize('positron.newConnectionModalDialog.provider', "Provider"))()}
				<DropDownListBox
					onSelectionChanged={(item) => setSource(item.options.value)}
					keybindingService={props.keybindingService}
					layoutService={props.layoutService}
					title={(() => localize('positron.newConnectionModalDialog.selectProvider', "Select Provider"))()}
					entries={providers}
					selectedIdentifier={source?.provider.id}
				/>
			</label>

			<LabeledTextInput
				value={name}
				label={(() => localize('positron.newConnectionModalDialog.name', "Name"))()}
				onChange={e => { setName(e.currentTarget.value) }}
			/>
			<LabeledTextInput
				value={model}
				label={(() => localize('positron.newConnectionModalDialog.model', "Model"))()}
				onChange={e => { setModel(e.currentTarget.value) }}
			/>
			{source?.supportedOptions.includes('baseUrl') &&
				<LabeledTextInput
					value={baseUrl ?? ''}
					label={(() => localize('positron.newConnectionModalDialog.baseURL', "Base URL"))()}
					onChange={e => { setBaseUrl(e.currentTarget.value) }}
				/>}
			{source?.supportedOptions.includes('project') &&
				<LabeledTextInput
					value={project ?? ''}
					label={(() => localize('positron.newConnectionModalDialog.project', "Google Cloud Project ID"))()}
					onChange={e => { setProject(e.currentTarget.value) }}
				/>}
			{source?.supportedOptions.includes('location') &&
				<LabeledTextInput
					value={location ?? ''}
					label={(() => localize('positron.newConnectionModalDialog.location', "Google Cloud Location"))()}
					onChange={e => { setLocation(e.currentTarget.value) }}
				/>}
			{source?.supportedOptions.includes('resourceName') &&
				<LabeledTextInput
					value={resourceName ?? ''}
					label={(() => localize('positron.newConnectionModalDialog.resourceName', "Azure resource name"))()}
					onChange={e => { setResourceName(e.currentTarget.value) }}
				/>}
			{source?.supportedOptions.includes('apiKey') &&
				<LabeledTextInput
					value={apiKey ?? ''}
					type='password'
					label={(() => localize('positron.newConnectionModalDialog.apiKey', "API Key"))()}
					onChange={e => { setApiKey(e.currentTarget.value) }}
				/>
			}
			{source?.supportedOptions.includes('numCtx') &&
				<LabeledTextInput
					value={numCtx ?? 2048}
					type='number'
					label={(() => localize('positron.newConnectionModalDialog.numCtx', "Context Window size"))()}
					onChange={e => { setNumCtx(parseInt(e.currentTarget.value)) }}
				/>
			}
			{source?.supportedOptions.includes('toolCalls') &&
				<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
					<input
						type='checkbox'
						id='toolCallsCheckbox'
						checked={toolCalls}
						onChange={e => { setToolCalls(e.target.checked) }}
					/>
					<label htmlFor='toolCallsCheckbox'>
						{(() => localize('positron.newConnectionModalDialog.toolCalls', "Enable tool calling"))()}
					</label>
				</div>
			}
		</VerticalStack>
	</OKCancelModalDialog>
}
