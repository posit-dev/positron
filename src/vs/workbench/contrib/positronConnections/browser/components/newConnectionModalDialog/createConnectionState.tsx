/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { PropsWithChildren, useRef } from 'react';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/button/positronButton';
import { localize } from 'vs/nls';
import { PositronConnectionsServices } from 'vs/workbench/contrib/positronConnections/browser/positronConnectionsContext';
import 'vs/css!./createConnectionState';
import { SimpleCodeEditor, SimpleCodeEditorWidget } from 'vs/workbench/contrib/positronConnections/browser/components/simpleCodeEditor';
import Severity from 'vs/base/common/severity';
import { Driver, Input, InputType } from 'vs/workbench/contrib/positronConnections/browser/components/newConnectionModalDialog/driver';
import { LabeledTextInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledTextInput';
import { RadioGroup } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/radioGroup';

interface CreateConnectionProps {
	readonly services: PositronConnectionsServices;
	readonly onCancel: () => void;
	readonly onBack: () => void;
	readonly selectedDriver: Driver;
}

export const CreateConnection = (props: PropsWithChildren<CreateConnectionProps>) => {

	const { name, languageId, inputs } = props.selectedDriver;
	const { onBack, onCancel, services } = props;
	const editorRef = useRef<SimpleCodeEditorWidget>(undefined!);

	const onCopy = async () => {
		const code = editorRef.current.getValue();
		await services.clipboardService.writeText(code);

		const handle = services.connectionsService.notify(localize(
			'positron.resumeConnectionModalDialog.codeCopied',
			"Connection code copied to clipboard"
		), Severity.Info);
		// close the notification after 2 seconds
		setTimeout(() => handle.close(), 2000);
	};

	return <div className='connections-new-connection-create-connection'>
		<div className='create-connection-title'>
			<h1>
				{`${name} ${localize('positron.newConnectionModalDialog.createConnection.title', "Connection")}`}
			</h1>
		</div>

		<form className='create-connection-inputs'>
			{
				inputs.map((input) => {
					return <FormElement key={input.id} {...input}></FormElement>;
				})
			}
		</form>

		<div className='create-connection-code-title'>
			{localize('positron.newConnectionModalDialog.createConnection.code', "Connection Code")}
		</div>

		<div className='create-connection-code-editor'>
			<SimpleCodeEditor
				ref={editorRef}
				services={props.services}
				language={languageId}
				editorOptions={{
					readOnly: true,
					cursorBlinking: 'solid'
				}}
			>
			</SimpleCodeEditor>
		</div>

		<div className='create-connection-buttons'>
			<PositronButton
				className='button action-bar-button'
				onPressed={onCopy}
			>
				{(() => localize('positron.newConnectionModalDialog.createConnection.copy', 'Copy'))()}
			</PositronButton>
			<PositronButton
				className='button action-bar-button'
				onPressed={props.onCancel}
			>
				{(() => localize('positron.newConnectionModalDialog.createConnection.cancel', 'Cancel'))()}
			</PositronButton>
		</div>

		<div className='create-connection-footer'>
			<PositronButton
				className='button action-bar-button'
				onPressed={onBack}
			>
				{(() => localize('positron.newConnectionModalDialog.createConnection.back', 'Back'))()}
			</PositronButton>
			<PositronButton
				className='button action-bar-button default'
				onPressed={onCancel}
			>
				{(() => localize('positron.newConnectionModalDialog.createConnection.connect', 'Connect'))()}
			</PositronButton>
		</div>
	</div>;
};

const FormElement = (props: PropsWithChildren<Input>) => {
	const { label, defaultValue = '', type } = props;

	switch (type) {
		case InputType.Number:
			return <div className='labeled-input'>
				<LabeledTextInput
					label={label}
					value={defaultValue}
					type='text'
				></LabeledTextInput>
			</div>;
		case InputType.Option:
			return <div className='labeled-input'><label>
				<span className='label-text'>{label}</span>
				<RadioGroup
					name={label}
					labelledBy={label}
					entries={props.options!.map(option => ({ options: option }))}
					initialSelectionId={props.options![0].identifier}
					onSelectionChanged={() => { }}
				/>
			</label></div>;
		case InputType.String:
		default:
			return <div className='labeled-input'>
				<LabeledTextInput
					label={label}
					value={defaultValue}
					type='text'
				></LabeledTextInput>
			</div>;
	}
};
