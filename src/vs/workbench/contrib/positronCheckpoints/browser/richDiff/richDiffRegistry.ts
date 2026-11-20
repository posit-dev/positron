/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';

/** One version of a file: its content, and the plain label for it ("Before" or "After"). */
export interface IRichDiffSide {
	bytes: VSBuffer;
	label: string;
}

/** What a provider receives. A side is absent when the file is new (no left) or removed (no right). */
export interface IRichDiffSides {
	left?: IRichDiffSide;
	right?: IRichDiffSide;
	path: string;
	title: string;
}

/** A comparison for the files with certain extensions, opened from "View detailed differences". */
export interface IRichDiffProvider {
	id: string;
	/** Lower-case extensions without the dot. */
	extensions: string[];
	/**
	 * The size in bytes above which a side is not given to the provider. A side over it opens the
	 * size message instead. The large file limit applies when this is absent.
	 */
	maxSideBytes?: number;
	/** Opens the comparison. A provider that rejects before it opens an editor lets the text comparison open instead. */
	open(accessor: ServicesAccessor, sides: IRichDiffSides): Promise<void>;
}

const providers: IRichDiffProvider[] = [];

function extensionOf(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The registry that `openDiff` asks before its text and data file handling. */
export const richDiffRegistry = {
	/** Adds a provider. Disposing the result removes it. */
	register(provider: IRichDiffProvider): IDisposable {
		providers.push(provider);
		return toDisposable(() => {
			const index = providers.indexOf(provider);
			if (index >= 0) {
				providers.splice(index, 1);
			}
		});
	},

	/** The first provider registered for the extension of `path`, in any letter case. */
	find(path: string): IRichDiffProvider | undefined {
		const extension = extensionOf(path);
		return extension === '' ? undefined : providers.find(provider => provider.extensions.includes(extension));
	},
};
