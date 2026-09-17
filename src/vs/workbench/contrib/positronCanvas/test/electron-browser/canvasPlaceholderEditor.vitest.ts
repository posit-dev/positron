/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Registry } from '../../../../../platform/registry/common/platform.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../../common/editor.js';
import { CanvasPlaceholderInput } from '../../browser/canvasPlaceholderEditor.js';
// The contribution is where an editor serializer for the placeholder would be
// registered; without it the registry below is trivially empty.
import '../../electron-browser/positronCanvas.contribution.js';

describe('CanvasPlaceholderInput', () => {
	const disposables = ensureNoLeakedDisposables();

	it('is a read-only singleton that no serializer will ever write into a saved layout', () => {
		const placeholder = disposables.add(new CanvasPlaceholderInput());
		const other = disposables.add(new CanvasPlaceholderInput());

		expect({
			readonly: placeholder.isReadonly(),
			resource: placeholder.resource,
			matchesAnother: placeholder.matches(other),
			serializer: Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).getEditorSerializer(placeholder),
		}).toEqual({ readonly: true, resource: undefined, matchesAnother: true, serializer: undefined });
	});
});
