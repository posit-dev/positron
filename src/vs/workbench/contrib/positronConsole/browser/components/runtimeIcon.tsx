/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStatus.css';

// Other dependencies.
import { URI } from '../../../../../base/common/uri.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { isQuartoOrRmdFile } from '../../../positronQuarto/common/positronQuartoConfig.js';

// Base64-encoded Quarto icon SVG for use in session tabs and interpreter picker.
// Source: quarto extension assets/icon/qmd.svg
export const QUARTO_ICON_SVG_BASE64 = 'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDI2LjIuMSwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPgo8c3ZnIHZlcnNpb249IjEuMSIgaWQ9IkxheWVyXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4IgoJIHZpZXdCb3g9IjAgMCAxNiAxNiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgMTYgMTY7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4KPHN0eWxlIHR5cGU9InRleHQvY3NzIj4KCS5zdDB7ZmlsbDojNEU5N0I0O30KPC9zdHlsZT4KPGc+Cgk8cGF0aCBjbGFzcz0ic3QwIiBkPSJNMTAuMzQsNy42NWg1LjE2Yy0wLjE3LTIuNzctMi4zOS00Ljk5LTUuMTYtNS4xNVY3LjY1eiIvPgoJPHBhdGggY2xhc3M9InN0MCIgZD0iTTkuNjQsNy42NVYyLjVDNi44OCwyLjY4LDQuNjcsNC44OSw0LjUsNy42NUg5LjY0eiIvPgoJPHBhdGggY2xhc3M9InN0MCIgZD0iTTkuNjQsOC4zNUg0LjVjMC4xNywyLjc3LDIuMzgsNC45OCw1LjE0LDUuMTVWOC4zNXoiLz4KCTxwYXRoIGNsYXNzPSJzdDAiIGQ9Ik0xMC4zNCw4LjM1djUuMTVjMi43OC0wLjE3LDQuOTktMi4zOCw1LjE2LTUuMTVIMTAuMzR6Ii8+CjwvZz4KPC9zdmc+Cg==';

export interface RuntimeIconProps {
	base64EncodedIconSvg: string | undefined;
	sessionMode: LanguageRuntimeSessionMode;
	notebookUri?: URI;
}

export const RuntimeIcon = ({ base64EncodedIconSvg, sessionMode, notebookUri }: RuntimeIconProps) => {
	const classNames = ['icon'];
	if (sessionMode === LanguageRuntimeSessionMode.Notebook) {
		// --- Start Positron ---
		// Show Quarto icon for Quarto/RMarkdown sessions instead of the
		// generic notebook icon.
		if (isQuartoOrRmdFile(notebookUri?.path)) {
			return <img
				className={positronClassNames(...classNames)}
				src={`data:image/svg+xml;base64,${QUARTO_ICON_SVG_BASE64}`}
			/>;
		}
		// --- End Positron ---
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
