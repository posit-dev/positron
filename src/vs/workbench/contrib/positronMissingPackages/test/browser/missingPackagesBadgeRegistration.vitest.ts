/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { PositronActionBarWidgetRegistry } from '../../../../../platform/positronActionBar/browser/positronActionBarWidgetRegistry.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../../positronNotebook/common/positronNotebookCommon.js';
import { MISSING_PACKAGES_SUPPORTED_KEY } from '../../browser/missingPackagesContextKey.js';
// Registers the badge widgets as a side effect.
import '../../browser/positronMissingPackages.contribution.js';

function badgesFor(activeEditor: string): string[] {
	const values: Record<string, unknown> = {
		activeEditor,
		[MISSING_PACKAGES_SUPPORTED_KEY.key]: true,
	};
	const contextKeyService = stubInterface<IContextKeyService>({
		contextMatchesRules: rules => !rules || rules.evaluate({ getValue: <T>(key: string) => values[key] as T }),
	});
	return PositronActionBarWidgetRegistry.getWidgets(MenuId.EditorActionsRight, contextKeyService)
		.map(w => w.id)
		.filter(id => id.startsWith('positronMissingPackages.'));
}

describe('missing packages badge registration', () => {
	it('shows only the notebook badge in a Positron notebook', () => {
		expect(badgesFor(POSITRON_NOTEBOOK_EDITOR_ID)).toEqual(['positronMissingPackages.notebookBadge']);
	});

	it('shows only the editor badge in a text editor', () => {
		expect(badgesFor('workbench.editors.files.textFileEditor')).toEqual(['positronMissingPackages.editorBadge']);
	});
});
