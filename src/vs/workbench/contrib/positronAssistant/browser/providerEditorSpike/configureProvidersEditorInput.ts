/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// SPIKE (#14695): throwaway proof-of-concept. This EditorInput demonstrates hosting the LLM
// provider configuration UI as a workbench editor that renders as a centered modal overlay,
// using the upstream 1.124.0 "Modal Editor Part" framework. It opts in via
// EditorInputCapabilities.RequiresModal and implements IModalEditorOptionsProvider, exactly
// like upstream's "Agent Customizations" editor (aiCustomizationManagementEditorInput.ts).
// Not intended to ship as-is.

import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IModalEditorOptions, IModalEditorOptionsProvider } from '../../../../../platform/editor/common/editor.js';

export class ConfigureProvidersEditorInput extends EditorInput implements IModalEditorOptionsProvider {
	static readonly TypeID = 'workbench.input.positronAssistant.configureProviders.spike';
	static readonly EditorID = 'workbench.editor.positronAssistant.configureProviders.spike';

	override get resource(): URI | undefined {
		return undefined;
	}

	override get editorId(): string {
		return ConfigureProvidersEditorInput.EditorID;
	}

	override get typeId(): string {
		return ConfigureProvidersEditorInput.TypeID;
	}

	// Singleton (one instance ever) + RequiresModal (always open in the modal editor part,
	// unless the user has set `workbench.editor.useModal: 'off'`, in which case it falls back
	// to a normal editor tab -- demonstrating the dual-host behavior for free).
	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly
			| EditorInputCapabilities.Singleton
			| EditorInputCapabilities.RequiresModal;
	}

	override getName(): string {
		return localize('positron.configureProvidersEditor.name', "Configure LLM Providers");
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof ConfigureProvidersEditorInput;
	}

	// Modal chrome customization: use the compact header (editor background, no title icon,
	// no bottom border), matching upstream's Agent Customizations editor.
	getModalEditorOptions(): IModalEditorOptions {
		return { compactHeader: true };
	}
}
