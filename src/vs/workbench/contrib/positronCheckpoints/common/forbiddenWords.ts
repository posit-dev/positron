/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** The git words, with their plural and verb forms, that match in any letter case. */
const ANY_CASE_WORDS = 'branch(es)?|commit(s|ted|ting)?|stag(e(d|s)?|ing)|rebas(e(d|s)?|ing)|merg(e(d|s)?|ing)|pull(s|ed|ing)?|push(es|ed|ing)?|fetch(es|ed|ing)?|conflict(s|ed|ing)?';

/**
 * The git words that the main view never shows (spec 2), as whole words with their plural and
 * verb forms. Every word matches in any letter case except `HEAD`, which matches only in capitals
 * so that the ordinary word "head" is allowed. The strings of the view and every text a model
 * writes for it are checked against this pattern.
 */
export const FORBIDDEN_WORDS = new RegExp(`\\b(${ANY_CASE_WORDS.replace(/[a-z]/g, letter => `[${letter}${letter.toUpperCase()}]`)}|HEAD)\\b`);
