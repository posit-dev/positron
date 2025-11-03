/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IPositronPlotsService } from '../../../services/positronPlots/common/positronPlots.js';

export interface IPositronPlotsGalleryEditorOptions {
	// Future: Add options for initial state like selected plot, zoom level, etc.
}

/**
 * Editor input for the Positron Plots Gallery editor.
 * This displays the full plots pane (with thumbnails, navigation, etc.) in an editor or auxiliary window.
 */
export class PositronPlotsGalleryEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.positronPlotsGallery';
	static readonly EditorID = 'workbench.editor.positronPlotsGallery';

	private static _counter = 0;

	/**
	 * The resource associated with this editor input.
	 */
	readonly resource = URI.from({
		scheme: Schemas.positronPlotsGallery,
		path: `plots-gallery-${PositronPlotsGalleryEditorInput._counter++}`
	});

	/**
	 * Gets a new URI for a plots gallery editor.
	 */
	static getNewEditorUri(): URI {
		return URI.from({
			scheme: Schemas.positronPlotsGallery,
			path: `plots-gallery-${PositronPlotsGalleryEditorInput._counter++}`
		});
	}

	constructor(
		@IPositronPlotsService _positronPlotsService: IPositronPlotsService
	) {
		super();
	}

	override get editorId(): string {
		return PositronPlotsGalleryEditorInput.EditorID;
	}

	override get typeId(): string {
		return PositronPlotsGalleryEditorInput.ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return localize('positronPlotsGallery.editorName', "Plots Gallery");
	}

	override getDescription(): string | undefined {
		return localize('positronPlotsGallery.editorDescription', "View and manage plots");
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof PositronPlotsGalleryEditorInput;
	}
}
