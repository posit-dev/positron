//
// error.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

use std::fmt;

#[derive(Debug)]
pub enum Error {
    UnexpectedLength(i32, i32),
    UnexpectedType(String, String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {

            Error::UnexpectedLength(expected, actual) => {
                write!(f, "Unexpected vector length (expected {}; got {})", expected, actual)
            }

            Error::UnexpectedType(expected, actual) => {
                write!(f, "Unexpected vector type (expected {}; got {})", expected, actual)
            }

        }
    }
}
