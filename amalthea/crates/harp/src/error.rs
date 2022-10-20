//
// error.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

use std::fmt;
use std::str::Utf8Error;

use crate::utils::r_type2char;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone)]
pub enum Error {
    EvaluationError(String, String),
    UnexpectedLength(u32, u32),
    UnexpectedType(u32, Vec<u32>),
    InvalidUtf8(Utf8Error)
}

// empty implementation required for 'anyhow'
impl std::error::Error for Error {}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {

            Error::EvaluationError(expression, message) => {
                write!(f, "Error evaluating {}: {}", expression, message)
            }

            Error::UnexpectedLength(actual, expected) => {
                write!(f, "Unexpected vector length (expected {}; got {})", expected, actual)
            }

            Error::UnexpectedType(actual, expected) => {
                unsafe {
                    let actual = r_type2char(*actual);
                    let expected = expected.iter().map(|value| r_type2char(*value)).collect::<Vec<_>>().join(" | ");
                    write!(f, "Unexpected vector type (expected {}; got {})", expected, actual)
                }
            }

            Error::InvalidUtf8(error) => {
                write!(f, "Invalid UTF-8 in string: {}", error)
            }

        }
    }
}

impl From<Utf8Error> for Error {
    fn from(error: Utf8Error) -> Self {
        Self::InvalidUtf8(error)
    }
}
