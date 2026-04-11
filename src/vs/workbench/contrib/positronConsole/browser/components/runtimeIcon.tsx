/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStatus.css';

// Other dependencies.
import { IModelService } from '../../../../../editor/common/services/model.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { isQuartoSession } from '../../common/sessionDisplayUtils.js';
import { asCssVariable } from '../../../../../platform/theme/common/colorUtils.js';
import { POSITRON_QUARTO_ICON } from '../../../../common/theme.js';
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
		if (isQuartoSession(notebookUri, modelService)) {
			classNames.push(...ThemeIcon.asClassNameArray(Codicon.positronQuarto));
			return <span className={positronClassNames(...classNames)} style={{ color: asCssVariable(POSITRON_QUARTO_ICON) }}></span>;
		}
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
