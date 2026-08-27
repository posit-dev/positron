/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Translating the positions sqlparser reports into the offsets the editor uses.
//!
//! The tokenizer records a [`Location`] as a 1-based line and a 1-based column counted in
//! Unicode scalar values. An editor position is an offset counted in UTF-16 code units. The two
//! disagree for anything outside the Basic Multilingual Plane -- an emoji in a comment is one
//! scalar value and two UTF-16 units -- so every position crosses this module rather than being
//! passed through as a number that happens to be right for ASCII.
//!
//! Doing the conversion here rather than on the TypeScript side is what keeps that hazard in one
//! place: everything leaving the analyzer is already a UTF-16 offset the caller can hand
//! straight to `TextDocument.positionAt`.

use sqlparser::tokenizer::Location;

/// Maps sqlparser locations to UTF-16 offsets for one document.
///
/// Built once per analysis and reused for every position in it. The alternative -- walking the
/// text per conversion -- is quadratic on a document with many diagnostics.
pub struct TextIndex {
    /// UTF-16 offset of the first character of each line. Every document has a line 0, including
    /// the empty one, so this is never empty.
    line_starts: Vec<u32>,
    /// Character index of the first character of each line, parallel to `line_starts`. Kept so
    /// the non-ASCII path can start its walk at the line rather than at the document, which is
    /// what makes converting many positions linear rather than quadratic.
    line_char_starts: Vec<usize>,
    /// Whether the document is entirely ASCII, in which case a column is already an offset and
    /// the per-character walk can be skipped. The overwhelmingly common case.
    ascii: bool,
    /// The document, kept for the per-character walk on the non-ASCII path.
    text: Vec<char>,
    /// UTF-16 length of the whole document, which every offset is clamped to.
    len: u32,
}

impl TextIndex {
    pub fn new(text: &str) -> Self {
        let ascii = text.is_ascii();
        let mut line_starts = vec![0u32];
        let mut line_char_starts = vec![0usize];
        let mut offset = 0u32;
        let chars: Vec<char> = text.chars().collect();
        for (index, character) in chars.iter().enumerate() {
            offset += character.len_utf16() as u32;
            if *character == '\n' {
                line_starts.push(offset);
                line_char_starts.push(index + 1);
            }
        }
        Self {
            line_starts,
            line_char_starts,
            ascii,
            text: if ascii { Vec::new() } else { chars },
            len: offset,
        }
    }

    /// The offset of the end of the document, in UTF-16 code units.
    pub fn end(&self) -> u32 {
        self.len
    }

    /// The UTF-16 offset of a tokenizer location.
    ///
    /// An empty location -- which is how sqlparser spells "this node did not come from the text",
    /// and what it reports for an error at end of input -- has no offset; see [`Self::span`].
    pub fn offset(&self, location: Location) -> Option<u32> {
        if location.line == 0 || location.column == 0 {
            return None;
        }
        let line = (location.line - 1) as usize;
        let start = *self.line_starts.get(line)?;
        // Columns are 1-based, so column 1 is the line start itself.
        let column = (location.column - 1) as u32;

        if self.ascii {
            return Some(self.clamp(start + column, line));
        }

        // Walk the line's characters, accumulating UTF-16 units, until the requested column is
        // reached. `start` counts UTF-16 units, so it cannot index `self.text` directly; the
        // parallel table gives the line's character index without rescanning the document.
        let mut offset = start;
        let mut index = self.line_char_starts[line];
        let mut remaining = column;
        while remaining > 0 {
            match self.text.get(index) {
                Some('\n') | None => break,
                Some(character) => {
                    offset += character.len_utf16() as u32;
                    index += 1;
                    remaining -= 1;
                }
            }
        }
        Some(self.clamp(offset, line))
    }

    /// Clamps an offset to the end of its line, so a column past the end of a line -- which is
    /// what sqlparser reports for a token that ended the line -- cannot run into the next one.
    fn clamp(&self, offset: u32, line: usize) -> u32 {
        let line_end = self.line_starts.get(line + 1).copied().unwrap_or(self.len);
        offset.min(line_end).min(self.len)
    }

    /// The UTF-16 range of a span, or `None` when the span carries no position.
    ///
    /// A span with only its start known still yields a range, one unit wide, so a node the parser
    /// only half-located is still pointed at rather than dropped.
    pub fn span(&self, span: sqlparser::tokenizer::Span) -> Option<(u32, u32)> {
        let start = self.offset(span.start)?;
        let end = self.offset(span.end).unwrap_or(start + 1);
        Some((start, end.max(start)))
    }
}

#[cfg(test)]
mod tests {
    use super::TextIndex;
    use sqlparser::tokenizer::Location;

    /// The offset of a 1-based line and column, as the tokenizer reports them.
    fn offset(text: &str, line: u64, column: u64) -> Option<u32> {
        TextIndex::new(text).offset(Location::new(line, column))
    }

    #[test]
    fn column_one_of_line_one_is_the_start_of_the_document() {
        assert_eq!(offset("SELECT 1", 1, 1), Some(0));
    }

    #[test]
    fn a_later_line_starts_after_the_newlines_before_it() {
        let text = "SELECT 1;\nSELECT 2;\nSELECT 3;";
        assert_eq!(offset(text, 2, 1), Some(10));
        assert_eq!(offset(text, 3, 1), Some(20));
    }

    #[test]
    fn an_empty_location_has_no_offset() {
        // How sqlparser spells "this did not come from the text", including for an error at end
        // of input. Reporting it as offset zero would squiggle the start of the document.
        assert_eq!(offset("SELECT 1", 0, 0), None);
    }

    #[test]
    fn characters_are_counted_in_utf16_units() {
        // The emoji is one Unicode scalar value, which is what a column counts, and two UTF-16
        // units, which is what an editor offset counts.
        let text = "SELECT '\u{1F600}', x";
        assert_eq!(offset(text, 1, 8), Some(7), "the opening quote");
        assert_eq!(offset(text, 1, 12), Some(12), "the comma, two units past the emoji");
        assert_eq!(u32::try_from(text.encode_utf16().count()).unwrap(), 14);
    }

    #[test]
    fn a_column_past_the_end_of_its_line_clamps_to_the_line() {
        // What the tokenizer reports for a token that ran to the end of a line.
        let text = "SELECT 1\nSELECT 2";
        assert_eq!(offset(text, 1, 999), Some(9), "the end of line one, newline included");
    }

    #[test]
    fn a_line_past_the_end_of_the_document_has_no_offset() {
        assert_eq!(offset("SELECT 1", 99, 1), None);
    }

    #[test]
    fn an_empty_document_has_a_first_line() {
        assert_eq!(offset("", 1, 1), Some(0));
        assert_eq!(TextIndex::new("").end(), 0);
    }

    #[test]
    fn a_carriage_return_belongs_to_the_line_it_ends() {
        let text = "SELECT 1;\r\nSELECT 2;";
        assert_eq!(offset(text, 2, 1), Some(11));
    }
}
