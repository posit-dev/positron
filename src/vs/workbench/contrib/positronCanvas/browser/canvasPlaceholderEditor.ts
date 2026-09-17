/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, Dimension, size } from '../../../../base/browser/dom.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';

/**
 * Holds the Canvas group while its panel is gone during a folder switch: an
 * empty auxiliary editor part closes its window, and that window is what
 * Canvas mode is. Read-only, so keystrokes under the switch curtain change
 * nothing and closing it never prompts. Deliberately without an editor
 * serializer, so the folder being left never records it in the layout saved
 * while the workspace storage switches.
 */
export class CanvasPlaceholderInput extends EditorInput {
	static readonly TypeID = 'workbench.input.positronCanvasPlaceholder';
	static readonly EditorID = 'workbench.editor.positronCanvasPlaceholder';

	/** No document behind it; identity is the class, see `matches`. */
	override get resource(): URI | undefined {
		return undefined;
	}

	override get editorId(): string {
		return CanvasPlaceholderInput.EditorID;
	}

	override get typeId(): string {
		return CanvasPlaceholderInput.TypeID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return localize('positron.canvas.placeholderName', "Canvas");
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof CanvasPlaceholderInput;
	}
}

/** An empty pane: the switch curtain covers the window while this shows. */
export class CanvasPlaceholderPane extends EditorPane {

	private readonly container = $('.positron-canvas-placeholder');

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
	) {
		super(CanvasPlaceholderInput.EditorID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		parent.appendChild(this.container);
	}

	override layout(dimension: Dimension): void {
		size(this.container, dimension.width, dimension.height);
	}
}
