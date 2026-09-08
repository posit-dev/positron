/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './connectProviderView.css';

import { localize } from '../../../../../nls.js';

/** Opens providers.json for advanced editing, closing the dialog. */
export const EditRawConfigLink = (props: { onClick: () => void }) => (
	<button className='connect-provider-edit-json' type='button' onClick={props.onClick}>
		{localize('positron.connectProvider.editJson', "Edit providers.json for advanced options (closes this dialog)")}
	</button>
);
