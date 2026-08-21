/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './connectProviderView.css';

import { useState } from 'react';

import { localize } from '../../../../../nls.js';
import { IPositronLanguageModelSource } from '../../common/interfaces/positronAssistantService.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { ConnectProviderHeader, ProviderErrorBanner } from './connectProviderView.js';
import { ProviderModalFooter } from './providerModalFooter.js';

export interface DeleteCustomProviderViewProps {
	source: IPositronLanguageModelSource;
	/** Runs the extension's delete. Rejects with the message to show inline. */
	onDelete: () => Promise<void>;
	/** Invoked by the footer Cancel button, returning to the provider's screen. */
	onCancel: () => void;
	/** Invoked by the footer Close button. */
	onClose: () => void;
}

/**
 * Confirms deleting a `providers.custom` entry. Its own screen rather than a
 * dialog stacked on this one, so Cancel lands back where the user was.
 */
export const DeleteCustomProviderView = (props: DeleteCustomProviderViewProps) => {
	const [pending, setPending] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string>();
	const name = props.source.provider.displayName;

	const onDelete = async () => {
		setPending(true);
		setErrorMessage(undefined);
		try {
			await props.onDelete();
		} catch (e) {
			setErrorMessage(e instanceof Error ? e.message : String(e));
			setPending(false);
		}
		// Nothing to reset on success: the source goes away and this unmounts.
	};

	return (
		<>
			<ContentArea>
				<div className='connect-provider-view' data-testid='provider-delete-view'>
					<ConnectProviderHeader source={props.source} />
					<div className='connect-provider-divider' />
					<p className='connect-provider-delete-prompt'>
						{localize(
							'positron.deleteCustomProvider.prompt',
							"Delete \"{0}\"? Its entry and its stored API key are both removed, and its models stop appearing in chat. This cannot be undone.",
							name
						)}
					</p>
					{errorMessage && <ProviderErrorBanner message={errorMessage} />}
					<div style={{ flexGrow: 1 }}>&nbsp;</div>
				</div>
			</ContentArea>
			<ProviderModalFooter
				cancelButton={{
					title: localize('positron.deleteCustomProvider.cancel', "Cancel"),
					disable: pending,
					onClick: props.onCancel,
				}}
				primaryButton={{
					title: pending
						? localize('positron.deleteCustomProvider.deleting', "Deleting...")
						: localize('positron.deleteCustomProvider.confirm', "Delete Provider"),
					disable: pending,
					loading: pending,
					onClick: onDelete,
				}}
				onClose={props.onClose}
			/>
		</>
	);
};
