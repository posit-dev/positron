/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Builds the identity a data connection node keeps across a refresh: its kind and name. Node handles
 * are minted from a counter on every fetch, so a node's id always changes even when the node itself
 * hasn't -- its kind and name are what actually stay the same. The pair is JSON-encoded so a name
 * that happens to contain the separator can't collide with a different kind/name pair.
 *
 * Shared by the tree, which matches nodes by it after a reload and when revealing a path, and by the
 * details editor, which builds paths from it for the tree to reveal.
 * @param kind The node's kind.
 * @param name The node's name.
 */
export function nodeReloadKey(kind: string, name: string): string {
	return JSON.stringify([kind, name]);
}
