//
// error.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use std::fmt;
use std::str::Utf8Error;

use crate::utils::r_type2char;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub enum Error {
    HelpTopicNotFoundError { topic: String, package: Option<String> },
    ParseError { code: String, message: String },
    EvaluationError { code: String, message: String },
    UnsafeEvaluationError(String),
    UnexpectedLength(u32, u32),
    UnexpectedType(u32, Vec<u32>),
    InvalidUtf8(Utf8Error),
    TryCatchError { message: Vec<String>, classes : Vec<String> },
    ParseSyntaxError { message: String, line: i32 }
}

// empty implementation required for 'anyhow'
impl std::error::Error for Error {

    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::InvalidUtf8(source) => Some(source),
            _ => None,
        }
    }

}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {

            Error::HelpTopicNotFoundError { topic, package } => {
                match package {
                    Some(package) => write!(f, "Help topic '{}' not available in package '{}'", topic, package),
                    None => write!(f, "Help topic '{}' not available", topic),
                }
            }

            Error::ParseError { code, message } => {
                write!(f, "Error parsing {}: {}", code, message)
            }

            Error::EvaluationError { code, message } => {
                write!(f, "Error evaluating {}: {}", code, message)
            }

            Error::UnsafeEvaluationError(code) => {
                write!(f, "Evaluation of function calls not supported in this context: {}", code)
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

            Error::TryCatchError { message: _, classes: _ } => {
                write!(f, "tryCatch error")
            }

            Error::ParseSyntaxError { message, line } => {
                write!(f, "Syntax error on line {} when parsing: {}", line, message)
            }

        }
    }
}

impl From<Utf8Error> for Error {
    fn from(error: Utf8Error) -> Self {
        Self::InvalidUtf8(error)
    }
}
