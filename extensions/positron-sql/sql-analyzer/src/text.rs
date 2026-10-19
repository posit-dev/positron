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
//!
//! The column arithmetic is rust-analyzer's `line-index`, which converts a column within a line
//! between UTF-8, UTF-16 and UTF-32 and only does work on the lines that hold a character outside
//! ASCII. What is kept here is the one thing it does not offer: offsets counted from the start of
//! the document in UTF-16 units, rather than from the start of a line.

use line_index::WideEncoding::{self, Utf16, Utf32};
use line_index::{LineCol, LineIndex, WideLineCol};
use sqlparser::tokenizer::Location;

/// Maps sqlparser locations to UTF-16 offsets for one document.
///
/// Built once per analysis and reused for every position in it.
pub struct TextIndex {
    lines: LineIndex,
    /// UTF-16 offset of the first character of each line, and one entry more: the length of the
    /// document, which is where a line after the last one would start. Every document has a line
    /// 0, including the empty one.
    starts: Vec<u32>,
    /// UTF-16 offset just past the last character of each line, its line break excluded. Where a
    /// construct that has to be closed on the line it opened on gets its closing delimiter; see
    /// [`crate::statements`].
    ends: Vec<u32>,
}

impl TextIndex {
    pub fn new(text: &str) -> Self {
        let lines = LineIndex::new(text);
        let mut starts = vec![0u32];
        let mut ends = Vec::new();
        for line in 0u32.. {
            let Some(range) = lines.line(line) else { break };
            let start = *starts.last().unwrap_or(&0);
            // The line's range includes its break. A carriage return before the newline belongs
            // to the break rather than to the line.
            let body = &text[range];
            let content = body.strip_suffix('\n').unwrap_or(body);
            let content = content.strip_suffix('\r').unwrap_or(content);
            ends.push(start + utf16_len(content));
            starts.push(start + utf16_len(body));
        }
        Self {
            lines,
            starts,
            ends,
        }
    }

    /// The offset of the end of the document, in UTF-16 code units.
    pub fn end(&self) -> u32 {
        *self.starts.last().unwrap_or(&0)
    }

    /// How many lines the document has.
    fn line_count(&self) -> usize {
        self.ends.len()
    }

    /// Converts a column within a 0-based line from one encoding to another.
    fn convert(&self, line: usize, column: u32, from: WideEncoding, to: WideEncoding) -> u32 {
        let line = line as u32;
        self.lines
            .to_utf8(from, WideLineCol { line, col: column })
            .and_then(|utf8: LineCol| self.lines.to_wide(to, utf8))
            .map_or(column, |wide| wide.col)
    }

    /// The offset just past the last character of a 0-based line, its line break excluded.
    ///
    /// A line past the end of the document ends where the document does, so a caller working from
    /// a location it has not checked cannot be handed an offset outside the text.
    pub fn line_end(&self, line: usize) -> u32 {
        self.ends.get(line).copied().unwrap_or(self.end())
    }

    /// The tokenizer location of a UTF-16 offset: the inverse of [`Self::offset`].
    ///
    /// Wanted for the one thing that runs backwards -- giving a token the analyzer synthesized a
    /// position, so that what the parser makes of it comes back locatable rather than as a node
    /// that came from nowhere. See [`crate::cursor`].
    pub fn location(&self, offset: u32) -> Location {
        let offset = offset.min(self.end());
        // The last line that starts at or before the offset. There is always one, since line 0
        // starts at 0.
        let line = self.starts[..self.line_count()]
            .partition_point(|start| *start <= offset)
            .saturating_sub(1);
        let column = self.convert(line, offset - self.starts[line], Utf16, Utf32);
        // Both are 1-based.
        Location::new(line as u64 + 1, column as u64 + 1)
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
        if line >= self.line_count() {
            return None;
        }
        // Columns are 1-based, so column 1 is the line start itself.
        let column = self.convert(line, (location.column - 1) as u32, Utf32, Utf16);
        // Clamped to the start of the next line, so a column past the end of a line -- which is
        // what sqlparser reports for a token that ended the line -- cannot run into the next one.
        Some((self.starts[line] + column).min(self.starts[line + 1]))
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

fn utf16_len(text: &str) -> u32 {
    text.encode_utf16().count() as u32
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
        assert_eq!(
            offset(text, 1, 12),
            Some(12),
            "the comma, two units past the emoji"
        );
        assert_eq!(u32::try_from(text.encode_utf16().count()).unwrap(), 14);
    }

    #[test]
    fn a_column_past_the_end_of_its_line_clamps_to_the_line() {
        // What the tokenizer reports for a token that ran to the end of a line.
        let text = "SELECT 1\nSELECT 2";
        assert_eq!(
            offset(text, 1, 999),
            Some(9),
            "the end of line one, newline included"
        );
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

    #[test]
    fn a_line_ends_before_its_break() {
        let index = TextIndex::new("SELECT 1;\nSELECT 22;\r\nSELECT 3");
        assert_eq!(index.line_end(0), 9, "before the newline");
        assert_eq!(index.line_end(1), 20, "before the carriage return");
        assert_eq!(
            index.line_end(2),
            30,
            "the last line ends with the document"
        );
        assert_eq!(
            index.line_end(99),
            30,
            "a line that does not exist cannot run past the end"
        );
    }

    #[test]
    fn a_location_round_trips_through_an_offset() {
        // The two directions have to agree, or a token the analyzer synthesizes lands somewhere
        // the text it was placed in is not. Checked at every position a cursor can be, which is
        // every character boundary: an offset between the two halves of a surrogate pair is not
        // one, and nothing on either side of the boundary can produce one.
        for text in [
            "SELECT 1",
            "SELECT 1;\nSELECT 2",
            "SELECT '\u{1F600}', x\nFROM t",
        ] {
            let index = TextIndex::new(text);
            let mut at = 0u32;
            for character in text.chars() {
                assert_eq!(
                    index.offset(index.location(at)),
                    Some(at),
                    "{text:?} at {at}"
                );
                at += character.len_utf16() as u32;
            }
            assert_eq!(
                index.offset(index.location(at)),
                Some(index.end()),
                "{text:?} at the end"
            );
        }
    }

    #[test]
    fn an_offset_past_the_end_locates_the_end() {
        let index = TextIndex::new("SELECT 1");
        assert_eq!(index.location(999), Location::new(1, 9));
    }
}
