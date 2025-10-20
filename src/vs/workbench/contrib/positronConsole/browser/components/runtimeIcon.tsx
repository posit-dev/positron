/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStatus.css';

// React.
import React from 'react';

// Other dependencies.
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';

export interface RuntimeIconProps {
	base64EncodedIconSvg: string | undefined;
	sessionMode: LanguageRuntimeSessionMode;
}

export const RuntimeIcon = ({ base64EncodedIconSvg, sessionMode }: RuntimeIconProps) => {
	if (sessionMode === LanguageRuntimeSessionMode.Notebook) {
		return <span className='codicon codicon-notebook icon'></span>;
	}
	if (base64EncodedIconSvg === undefined) {
		return null;
	}
	return <img
		className='icon'
		src={`data:image/svg+xml;base64,${base64EncodedIconSvg}`}
	/>;
};
