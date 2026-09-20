/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Which session serves the cells of a Quarto document.
//
// Positron core builds a hidden notebook for every open Quarto document so that
// language servers see its code chunks as ordinary notebook cells. A Quarto
// session's language client claims the cells of its own document here once it
// is running, and the console client, which syncs the cells of every Quarto
// document, declines the ones with a claim. Ownership is decided at request
// time, so it moves when a session starts and comes back when it exits.
//
// Kept free of `vscode` imports so it can be unit tested directly. Copied per
// extension (positron-r, positron-python), since extensions cannot share
// source; `extensions/quartoCells-copies.vitest.ts` keeps the copies in step.

/**
 * The type core gives the hidden notebooks. No other notebook carries it, so a
 * document selector can name these cells through `notebookType` alone.
 */
export const QUARTO_CELLS_NOTEBOOK_TYPE = 'quarto-cells';

/** The URI scheme of the hidden notebooks, which happens to match the type. */
export const QUARTO_CELLS_SCHEME = 'quarto-cells';

/**
 * The path of the hidden notebook for a Quarto document.
 *
 * Mirrors `quartoNotebookUri` in core's quartoVirtualNotebookService.ts: the
 * source path with `.ipynb` appended, after `.qmd` when the source has no
 * Quarto extension of its own, which is the untitled case.
 */
export function quartoCellsNotebookPath(sourcePath: string): string {
    const lower = sourcePath.toLowerCase();
    const isQuarto = lower.endsWith('.qmd') || lower.endsWith('.rmd');
    const quartoPath = isQuarto ? sourcePath : `${sourcePath}.qmd`;
    return `${quartoPath}.ipynb`;
}

/** Told the URI of a hidden notebook and whether a session now serves it. */
export type QuartoCellsOwnershipListener = (notebookUri: string, owned: boolean) => void;

// Notebook key -> the ids of the sessions currently claiming it. More than
// one owner at a time is expected: closing and reopening a document, or
// restarting its session, can start the new client before the old one's
// stopped event lands, so both hold the key at once for a moment. A map
// entry is never left empty; a key with no owners is removed instead so
// `hasQuartoCellsOwner` can just check for the key's presence.
const owners = new Map<string, Set<string>>();
const listeners = new Set<QuartoCellsOwnershipListener>();

function notify(notebookUri: string, owned: boolean): void {
    for (const listener of listeners) {
        listener(notebookUri, owned);
    }
}

/**
 * Record that a session's client serves the cells of a hidden notebook.
 *
 * Call this when the client is running, not when it is created: until then
 * the server has no cells, and the console client has to keep answering.
 * Safe to call more than once for the same owner; a repeat claim is a no-op.
 * Notifies only when the key goes from no owners to one, so a second owner
 * claiming a key another session already holds fires no event.
 */
export function claimQuartoCells(notebookUri: string, ownerId: string): void {
    let ownerIds = owners.get(notebookUri);
    if (!ownerIds) {
        ownerIds = new Set<string>();
        owners.set(notebookUri, ownerIds);
    }
    const hadNoOwners = ownerIds.size === 0;
    ownerIds.add(ownerId);
    if (hadNoOwners) {
        notify(notebookUri, true);
    }
}

/**
 * Record that a session's client no longer serves the cells of a hidden
 * notebook.
 *
 * Removes only the given owner's own claim, so a release from a session
 * whose client already stopped can never drop a different session's claim
 * to the same key. Without that, a stale release landing after a new
 * client had already claimed the same key would hand the cells back to the
 * console while the new client was still running, which is the defect this
 * function exists to avoid. A release from an owner that never claimed the
 * key, or for a key with no owners at all, is a silent no-op with no
 * notification; that also covers a session that fails during startup and so
 * never had a claim to release. Notifies only when the key goes from having
 * owners to having none, and removes the map entry then so the registry
 * does not grow without bound.
 */
export function releaseQuartoCells(notebookUri: string, ownerId: string): void {
    const ownerIds = owners.get(notebookUri);
    if (!ownerIds?.delete(ownerId)) {
        return;
    }
    if (ownerIds.size === 0) {
        owners.delete(notebookUri);
        notify(notebookUri, false);
    }
}

/** Whether any session's client serves the cells of a hidden notebook. */
export function hasQuartoCellsOwner(notebookUri: string): boolean {
    return owners.has(notebookUri);
}

/** Subscribe to ownership changes. */
export function onDidChangeQuartoCellsOwnership(listener: QuartoCellsOwnershipListener): { dispose(): void } {
    listeners.add(listener);
    return {
        dispose() {
            listeners.delete(listener);
        },
    };
}
