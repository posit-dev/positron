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

// Configuration key controlling whether a connection's only schema is shown at all. Off by default:
// a schema with no siblings is dropped from the tree entirely -- no "Schemas" group and no schema
// row -- and its contents (Tables, Views, and so on) stand directly under the connection or database
// that holds it. Turning it on brings the schema back, folded together with its group into one
// "Schemas · public" row rather than costing two levels. Read by _breadcrumbNamespaceGroups in
// dataConnectionsTreeInstance.tsx and registered in positronDataConnections.contribution.ts.
//
// Schemas only, unlike the folding it builds on (see BREADCRUMB_GROUP_KINDS). Hiding a lone database
// or catalog would take the connection's own identity with it, and a name the user typed into the
// connection dialog is not ceremony the tree can decide to drop.
export const POSITRON_DATA_CONNECTIONS_TREE_SHOW_SINGLE_SCHEMA_KEY = 'dataConnections.tree.showSingleSchema';

// The narrowest indent this view will render, matching the floor workbench.tree.indent declares for
// itself. The setting's own minimum has to be 0 to leave room for the inherit sentinel, so this is
// what keeps 1, 2, and 3 out: at those widths the indent guides tile into a solid bar.
export const POSITRON_DATA_CONNECTIONS_MINIMUM_INDENT_WIDTH = 4;
