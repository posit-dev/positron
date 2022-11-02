// 
// point.rs
// 
// Copyright (C) 2022 by Posit, PBC
// 
// 

use tower_lsp::lsp_types::Position;
use tree_sitter::Point;

fn compare(lhs: Point, rhs: Point) -> i32 {

    if lhs.row < rhs.row {
        return -1;
    } else if lhs.row > rhs.row {
        return 1;
    } else if lhs.column < rhs.column {
        return -1;
    } else if lhs.column > rhs.column {
        return 1;
    } else {
        return 0;
    }

}

pub(crate) trait PointExt {

    fn as_position(self) -> Position;
    fn is_before(self, other: Point) -> bool;
    fn is_before_or_equal(self, other: Point) -> bool;
    fn is_equal(self, other: Point) -> bool;
    fn is_after_or_equal(self, other: Point) -> bool;
    fn is_after(self, other: Point) -> bool;

}

impl PointExt for Point {

    fn as_position(self) -> Position {
        Position { line: self.row as u32, character: self.column as u32 }
    }

    fn is_before(self, other: Point) -> bool {
        return compare(self, other) < 0;
    }

    fn is_before_or_equal(self, other: Point) -> bool {
        return compare(self, other) <= 0;
    }

    fn is_equal(self, other: Point) -> bool {
        return compare(self, other) == 0;
    }

    fn is_after_or_equal(self, other: Point) -> bool {
        return compare(self, other) >= 0;
    }

    fn is_after(self, other: Point) -> bool {
        return compare(self, other) > 0;
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_point_comparison() {

        let p34 = Point::new(3, 4);
        let p43 = Point::new(4, 3);
        let p44 = Point::new(4, 4);

        assert!(p44.is_before_or_equal(p44));
        assert!(p44.is_equal(p44));
        assert!(p44.is_after_or_equal(p44));


        assert!(p34.is_before(p44));
        assert!(p44.is_after(p34));

        assert!(p34.is_before(p43));
        assert!(p43.is_after(p34));
    }
}
