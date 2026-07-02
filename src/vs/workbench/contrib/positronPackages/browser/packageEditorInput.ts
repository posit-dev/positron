/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

/** The identity of a package detail editor. Carries no live data. */
export interface IPackageEditorIdentity {
	/** The language id of the originating session (e.g. 'r', 'python'). */
	readonly languageId: string;
	/** The session id this editor is pinned to. */
	readonly sessionId: string;
	/** The package name. */
	readonly packageName: string;
}

const PackageEditorIcon = ThemeIcon.fromId(Codicon.package.id);

export class PackageEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.positronPackageDetail';

	constructor(readonly identity: IPackageEditorIdentity) {
		super();
	}

	override get typeId(): string {
		return PackageEditorInput.ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override get resource(): URI {
		// Identity-bearing URI: session in the authority, package name in the path.
		// The package name is lowercased so the framework's URI-based editor
		// deduplication (extUri.isEqual is case-sensitive on the path) stays
		// consistent with the case-insensitive matches() below.
		return URI.from({
			scheme: 'positron-package',
			authority: this.identity.sessionId,
			path: '/' + this.identity.packageName.toLowerCase(),
		});
	}

	override getName(): string {
		return localize('positron.packageInputName', "Package: {0}", this.identity.packageName);
	}

	override getIcon(): ThemeIcon {
		return PackageEditorIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}
		return other instanceof PackageEditorInput
			&& other.identity.sessionId === this.identity.sessionId
			&& other.identity.packageName.toLowerCase() === this.identity.packageName.toLowerCase();
	}
}
