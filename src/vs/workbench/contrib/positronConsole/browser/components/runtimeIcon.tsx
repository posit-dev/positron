/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeIcon.css';

// Other dependencies.
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { getSessionIconClasses } from '../../common/sessionDisplayUtils.js';
import { URI } from '../../../../../base/common/uri.js';

export interface RuntimeIconProps {
	sessionMode: LanguageRuntimeSessionMode;
	notebookUri?: URI;
	languageId: string;
}

export const RuntimeIcon = ({ sessionMode, notebookUri, languageId }: RuntimeIconProps) => {
	const services = usePositronReactServicesContext();
	const iconClasses = getSessionIconClasses(
		{ sessionMode, notebookUri, languageId },
		services.modelService,
		services.languageService,
	);
	return <span className={positronClassNames('runtime-session-icon', ...iconClasses)}></span>;
};
