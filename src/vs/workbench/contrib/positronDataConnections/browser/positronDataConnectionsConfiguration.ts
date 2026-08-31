/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Configuration key that gates the Positron Data Connections feature. Shared by
// positronDataConnections.contribution.ts (registers the setting and the view),
// positronDataConnectionsCommands.ts (the command payloads report nothing when this is off, so the
// commands stay registered and Assistant-side feature-detection is a simple getCommands() check),
// and positronDataConnectionsInspectActions.ts (the Command Palette entries' precondition).
export const POSITRON_DATA_CONNECTIONS_ENABLED_KEY = 'dataConnections.enabled';

// Configuration key for the Data Connections tree's per-level indent, in pixels. Zero means "follow
// workbench.tree.indent" -- see resolveIndentWidth in dataConnectionsTreeInstance.tsx, which reads
// it, and positronDataConnections.contribution.ts, which registers it.
//
// This view gets a knob of its own because it nests far deeper than the trees workbench.tree.indent
// was tuned for: a column sits up to eight levels down (connection > Catalogs > catalog > Schemas >
// schema > Tables > table > Columns > column), so every pixel of the per-level step costs eight
// pixels of the panel's width before the name is reached.
export const POSITRON_DATA_CONNECTIONS_TREE_INDENT_KEY = 'dataConnections.tree.indent';
