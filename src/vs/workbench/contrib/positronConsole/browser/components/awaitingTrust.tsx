/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import 'vs/css!./emptyConsole';
import * as React from 'react';
import { localize } from 'vs/nls';

const awaitingTrust = localize('positron.awaitingWorkspaceTrust', "Enable trust in this workspace before starting an interpreter.");

/**
 * AwaitingTrust component.
 * @returns The rendered component.
 */
export const AwaitingTrust = () => {

	// Render.
	return (
		<div className='awaiting-trust'>
			<div className='title'>
				<span>{awaitingTrust}</span>
			</div>
		</div>
	);
};
