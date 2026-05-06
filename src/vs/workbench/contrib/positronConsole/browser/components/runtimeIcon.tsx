/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeIcon.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { getSessionIconClasses } from '../../common/sessionDisplayUtils.js';
import { URI } from '../../../../../base/common/uri.js';
import { IWorkbenchFileIconTheme } from '../../../../services/themes/common/workbenchThemeService.js';

/**
 * Seti is the default file icon theme. Its font glyphs are drawn offset-right
 * within the em quad, so language-contributed SVGs (rendered via background-image
 * with `left center`) visually misalign with adjacent Seti glyphs. To compensate,
 * we add a class when Seti is active which compensates for this.
 *
 * To know when to apply the shim CSS we need to know the active file icon theme.
 * Compare against `settingsId` (the value users set in `workbench.iconTheme`).
 */
const SETI_ICON_THEME_SETTINGS_ID = 'vs-seti';

export interface RuntimeIconProps {
	sessionMode: LanguageRuntimeSessionMode;
	notebookUri?: URI;
	languageId: string;
	'data-testid'?: string;
}

export const RuntimeIcon = ({ sessionMode, notebookUri, languageId, 'data-testid': dataTestId }: RuntimeIconProps) => {
	const services = usePositronReactServicesContext();

	const [iconThemeSettingsId, setIconThemeSettingsId] = useState(
		() => (services.themeService.getFileIconTheme() as IWorkbenchFileIconTheme).settingsId,
	);

	useEffect(() => {
		const disposable = services.themeService.onDidFileIconThemeChange((theme) => {
			setIconThemeSettingsId((theme as IWorkbenchFileIconTheme).settingsId);
		});
		return () => disposable.dispose();
	}, [services.themeService]);

	const iconClasses = getSessionIconClasses(
		{ sessionMode, notebookUri, languageId },
		services.modelService,
		services.languageService,
	);
	return (
		<span
			className={positronClassNames(
				'runtime-session-icon',
				...iconClasses,
				{ 'seti-icon-theme-active': iconThemeSettingsId === SETI_ICON_THEME_SETTINGS_ID },
			)}
			data-testid={dataTestId}
		></span>
	);
};
