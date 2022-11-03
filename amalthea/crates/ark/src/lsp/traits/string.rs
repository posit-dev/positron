//
// string.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

fn _fuzzy_matches(lhs: &str, rhs: &str) -> bool {

    // get iterator over rhs string
    let mut it = rhs.chars();
    let mut rch = match it.next() {
        Some(rhs) => rhs,
        None => return false,
    };

    // now iterate over lhs characters, looking for matches in rhs
    // if we exhaust all of the characters in rhs, then we found a match
    for lch in lhs.chars() {
        if lch.to_ascii_lowercase() == rch.to_ascii_lowercase() {
            rch = match it.next() {
                Some(rch) => rch,
                None => return true,
            }
        }
    }

    // if we get here, the match failed (some rhs characters didn't match)
    false

}

pub trait StringExt {
    fn fuzzy_matches(&self, rhs: impl AsRef<str>) -> bool;
}

impl StringExt for &str {
    fn fuzzy_matches(&self, rhs: impl AsRef<str>) -> bool {
        _fuzzy_matches(self.as_ref(), rhs.as_ref())
    }
}

impl StringExt for String {
    fn fuzzy_matches(&self, rhs: impl AsRef<str>) -> bool {
        _fuzzy_matches(self.as_ref(), rhs.as_ref())
    }
}

