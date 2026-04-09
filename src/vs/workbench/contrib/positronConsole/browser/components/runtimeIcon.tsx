/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStatus.css';

// Other dependencies.
import { URI } from '../../../../../base/common/uri.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { isQuartoDocument } from '../../../positronQuarto/common/positronQuartoConfig.js';

// Base64-encoded Quarto icon SVG for use in session tabs and interpreter picker.
// Source: quarto extension assets/icon/qmd.svg, with viewBox adjusted to center
export const QUARTO_ICON_SVG_BASE64 = 'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPCEtLSBCYXNlZCBvbiBxdWFydG8gZXh0ZW5zaW9uIGFzc2V0cy9pY29uL3FtZC5zdmcsIHdpdGggdmlld0JveCBhZGp1c3RlZCB0byBjZW50ZXIgdGhlIGljb24gLS0+CjxzdmcgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHg9IjBweCIgeT0iMHB4IgoJIHZpZXdCb3g9IjQuNSAyLjUgMTEgMTEiIHN0eWxlPSJlbmFibGUtYmFja2dyb3VuZDpuZXcgNC41IDIuNSAxMSAxMTsiIHhtbDpzcGFjZT0icHJlc2VydmUiPgo8c3R5bGUgdHlwZT0idGV4dC9jc3MiPgoJLnN0MHtmaWxsOiM0RTk3QjQ7fQo8L3N0eWxlPgo8Zz4KCTxwYXRoIGNsYXNzPSJzdDAiIGQ9Ik0xMC4zNCw3LjY1aDUuMTZjLTAuMTctMi43Ny0yLjM5LTQuOTktNS4xNi01LjE1VjcuNjV6Ii8+Cgk8cGF0aCBjbGFzcz0ic3QwIiBkPSJNOS42NCw3LjY1VjIuNUM2Ljg4LDIuNjgsNC42Nyw0Ljg5LDQuNSw3LjY1SDkuNjR6Ii8+Cgk8cGF0aCBjbGFzcz0ic3QwIiBkPSJNOS42NCw4LjM1SDQuNWMwLjE3LDIuNzcsMi4zOCw0Ljk4LDUuMTQsNS4xNVY4LjM1eiIvPgoJPHBhdGggY2xhc3M9InN0MCIgZD0iTTEwLjM0LDguMzV2NS4xNWMyLjc4LTAuMTcsNC45OS0yLjM4LDUuMTYtNS4xNUgxMC4zNHoiLz4KPC9nPgo8L3N2Zz4K';

/**
 * Checks if a notebook URI belongs to a Quarto/RMarkdown document by looking
 * up the editor model's language ID. This works for both saved files (where the
 * URI path has .qmd/.rmd) and untitled files (where the model's language ID is
 * set to "quarto" or "rmd" by the Quarto extension).
 */
export function isQuartoSession(notebookUri: URI | undefined, modelService: IModelService): boolean {
	if (!notebookUri) {
		return false;
	}
	const model = modelService.getModel(notebookUri);
	return isQuartoDocument(notebookUri.path, model?.getLanguageId());
}

export interface RuntimeIconProps {
	base64EncodedIconSvg: string | undefined;
	sessionMode: LanguageRuntimeSessionMode;
	notebookUri?: URI;
	modelService: IModelService;
}

export const RuntimeIcon = ({ base64EncodedIconSvg, sessionMode, notebookUri, modelService }: RuntimeIconProps) => {
	const classNames = ['icon'];
	if (sessionMode === LanguageRuntimeSessionMode.Notebook) {
		// --- Start Positron ---
		// Show Quarto icon for Quarto/RMarkdown sessions instead of the
		// generic notebook icon.
		if (isQuartoSession(notebookUri, modelService)) {
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
