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
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';

export interface RuntimeIconProps {
	base64EncodedIconSvg: string | undefined;
	sessionMode: LanguageRuntimeSessionMode;
}

export const RuntimeIcon = ({ base64EncodedIconSvg, sessionMode }: RuntimeIconProps) => {
	const classNames = ['icon']
	if (sessionMode === LanguageRuntimeSessionMode.Notebook) {
		classNames.push(...ThemeIcon.asClassNameArray(Codicon.notebook));
		return <span className={positronClassNames(...classNames)}></span>;
	}
	if (base64EncodedIconSvg === undefined) {
		return null;
	}
	return <img
		className={positronClassNames(...classNames)}
		src={`data:image/svg+xml;base64,${base64EncodedIconSvg}`}
	/>;
};
