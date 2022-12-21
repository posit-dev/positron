//
// range.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use stdext::all;
use tree_sitter::Range;
use tree_sitter::Point;

use crate::lsp::traits::point::PointExt;

pub trait RangeExt {
    fn contains_point(&self, point: Point) -> bool;
}

impl RangeExt for Range {

    fn contains_point(&self, point: Point) -> bool {
        all!(
            self.start_point.is_before_or_equal(point)
            self.end_point.is_after_or_equal(point)
        )
    }

}
