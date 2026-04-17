/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStatus.css';

// Other dependencies.
import { IModelService } from '../../../../../editor/common/services/model.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { getSessionIcon, getSessionIconStyle } from '../../common/sessionDisplayUtils.js';
import { URI } from '../../../../../base/common/uri.js';

export interface RuntimeIconProps {
	base64EncodedIconSvg: string | undefined;
	sessionMode: LanguageRuntimeSessionMode;
	notebookUri?: URI;
	modelService: IModelService;
}

export const RuntimeIcon = ({ base64EncodedIconSvg, sessionMode, notebookUri, modelService }: RuntimeIconProps) => {
	const classNames = ['icon'];

	if (sessionMode === LanguageRuntimeSessionMode.Notebook) {
		const icon = getSessionIcon({ sessionMode, notebookUri }, modelService);
		const style = getSessionIconStyle({ sessionMode, notebookUri }, modelService);
		classNames.push(...ThemeIcon.asClassNameArray(icon));
		return <span className={positronClassNames(...classNames)} style={style}></span>;
	}

	if (base64EncodedIconSvg === undefined) {
		return null;
	}
	return <img
		className={positronClassNames(...classNames)}
		src={`data:image/svg+xml;base64,${base64EncodedIconSvg}`}
	/>;
};
