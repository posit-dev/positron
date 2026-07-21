/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../../base/common/event.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { EditorPartModalContext } from '../../../../../common/contextkeys.js';
import { SettingsEditor2Input } from '../../../../../services/preferences/common/preferencesEditorInput.js';
import { TestEditorInput } from '../../../../../test/browser/workbenchTestServices.js';
import { IEditorGroupView } from '../../editor.js';
import { EditorActionBarControlFactory } from '../../editorActionBarControl.js';

describe('EditorActionBarControlFactory enablement', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	// Stub the instantiation service so creating the control yields a sentinel
	// disposable instead of rendering the real React control. This lets us observe
	// only the enablement DECISION: `factory.control` is defined when the factory
	// decides to show the action bar, undefined when it suppresses it.
	const controlInstantiationService = () => stubInterface<IInstantiationService>({
		// The factory only ever calls createInstance(EditorActionBarControl, ...);
		// cast past the overloaded signature to return a lightweight disposable.
		createInstance: (() => toDisposable(() => { })) as unknown as IInstantiationService['createInstance'],
	});

	it('suppresses the action bar when the editor group is in a modal part', () => {
		// Regression: Settings opens in the modal editor part, whose header already
		// renders its own toolbar. Without the modal gate, the "Settings always
		// enables" branch would add the Positron action bar as a spurious second row
		// of icons on the dialog and leak action bar widgets (e.g. the Quarto kernel
		// status badge) into it. See posit-dev/positron#14781 and #14826.
		//
		// A Settings input is used deliberately: it is the case that force-enables the
		// action bar, so the assertion only holds if the modal gate runs *before* that
		// branch. Removing the gate falls through to the enable path, `createInstance`
		// runs, and `factory.control` becomes defined, failing this test.
		const contextKeyService = ctx.disposables.add(
			ctx.get(IContextKeyService).createScoped(document.createElement('div'))
		);
		EditorPartModalContext.bindTo(contextKeyService).set(true);

		const settingsInput = ctx.disposables.add(
			new TestEditorInput(URI.file('/settings'), SettingsEditor2Input.ID)
		) as TestEditorInput & IDisposable;
		const group = stubInterface<IEditorGroupView>({
			activeEditor: settingsInput,
			onDidActiveEditorChange: Event.None,
		});

		const factory = ctx.disposables.add(new EditorActionBarControlFactory(
			document.createElement('div'),
			group,
			ctx.get(IConfigurationService),
			controlInstantiationService(),
			contextKeyService,
		));

		expect(factory.control).toBeUndefined();
	});
});
