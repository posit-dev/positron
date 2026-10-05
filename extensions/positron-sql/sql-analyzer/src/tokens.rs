/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Small readings of a statement's tokens, shared by the modules that scan them rather than parse
//! them: [`crate::sources`], [`crate::keywords`] and [`crate::cursor`].

use sqlparser::tokenizer::{Token, TokenWithSpan, Word};

use crate::text::TextIndex;

/// The word a token is, if it is one.
pub fn word(token: &TokenWithSpan) -> Option<&Word> {
    match &token.token {
        Token::Word(word) => Some(word),
        _ => None,
    }
}

/// The tokens on either side of the cursor, with the word being typed dropped.
///
/// The token under the cursor is the word being completed, not a word the statement contains: at
/// `SELECT * FROM ord|` the user has typed three characters of a table name, and reading them as
/// a finished name would answer for the slot *after* the table rather than the slot it sits in.
/// Dropping it never hides it, because what belongs at the cursor is by definition what the user
/// is in the middle of typing.
///
/// Only a word is dropped. Punctuation ending at the cursor is finished by construction -- there
/// is no half-typed `=` -- and `WHERE x =` must read as a value slot rather than as the position
/// after `x`.
pub fn around<'a>(
    tokens: &'a [TokenWithSpan],
    offset: u32,
    index: &TextIndex,
) -> (&'a [TokenWithSpan], &'a [TokenWithSpan]) {
    let mut cut = 0;
    let mut resume = tokens.len();

    for (at, token) in tokens.iter().enumerate() {
        let Some((start, end)) = index.span(token.span) else { continue };
        // Spans are half open, so a token occupying `[start, end)` is finished when its end has
        // been reached.
        if end <= offset {
            cut = at + 1;
            continue;
        }
        // The first token the cursor has not run past. It either straddles the cursor, and is the
        // one being typed, or begins at or after it and is untouched.
        resume = if start < offset { at + 1 } else { at };
        break;
    }

    // A word ending exactly where the cursor is is also one being typed, since that is what the
    // cursor sits at the end of while it is being written.
    if let Some(last) = cut.checked_sub(1) {
        let typing = index
            .span(tokens[last].span)
            .map(|(start, end)| end == offset && start < offset)
            .unwrap_or(false);
        if typing && matches!(tokens[last].token, Token::Word(_)) {
            cut = last;
        }
    }

    (&tokens[..cut], &tokens[resume.max(cut)..])
}

/// A dotted name's parts read from the right: the last is the object, the one before it the
/// schema, the one before that the catalog. A name with fewer parts simply says less.
///
/// `None` for a name with no parts at all.
pub fn qualified<T: Clone>(parts: &[T]) -> Option<(T, Option<T>, Option<T>)> {
    let part = |back: usize| parts.len().checked_sub(back).and_then(|at| parts.get(at)).cloned();
    Some((part(1)?, part(2), part(3)))
}
