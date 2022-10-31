//
// unwrap.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

#[derive(Debug, Clone)]
pub struct EmptyOptionError {
}

impl std::fmt::Display for EmptyOptionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Unexpected empty option value")
    }
}

impl std::error::Error for EmptyOptionError {}

#[derive(Debug, Clone)]
pub struct FalsyValueError {
}

impl std::fmt::Display for FalsyValueError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Unexpected falsy value")
    }
}

pub trait IntoResult<T, E> {
    fn into_result(self) -> Result<T, E>;
}

impl<T, E> IntoResult<T, E> for Result<T, E> {
    fn into_result(self) -> Result<T, E> { self }
}

impl IntoResult<bool, FalsyValueError> for bool {
    fn into_result(self) -> Result<bool, FalsyValueError> {
        if self { Ok(self) } else { Err(FalsyValueError {}) }
    }
}

impl<T> IntoResult<T, EmptyOptionError> for Option<T> {
    fn into_result(self) -> Result<T, EmptyOptionError> {
        self.ok_or(EmptyOptionError {})
    }
}

#[doc(hidden)]
pub fn _into_result<T, E>(object: impl IntoResult<T, E>) -> Result<T, E> {
    object.into_result()
}

#[macro_export]
macro_rules! unwrap {

    ($value:expr, Err($id:ident) => $error:expr) => {
        match $crate::unwrap::_into_result($value) {
            Ok(value) => value,
            Err($id) => $error,
        }
    };

    ($value:expr, Err(_) => $error:expr) => {
        match $crate::unwrap::_into_result($value) {
            Ok(value) => value,
            Err(_) => $error,
        }
    };

    ($value:expr, None => $error:expr) => {
        match $value {
            Some(value) => value,
            None => $error,
        }
    };

}
