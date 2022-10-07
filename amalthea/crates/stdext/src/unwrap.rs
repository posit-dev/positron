//
// unwrap.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

pub trait IntoResult<T, E> {
    fn into_result(self) -> Result<T, E>;
}

impl<T, E> IntoResult<T, E> for Result<T, E> {
    fn into_result(self) -> Result<T, E> { self }
}

impl<T> IntoResult<T, ()> for Option<T> {
    fn into_result(self) -> Result<T, ()> { self.ok_or(()) }
}

#[doc(hidden)]
pub fn _into_result<T, E>(object: impl IntoResult<T, E>) -> Result<T, E> {
    object.into_result()
}

#[macro_export]
macro_rules! unwrap {

    ($value: expr, $id: ident $error: block) => {
        match $crate::unwrap::_into_result($value) {
            Ok(value) => value,
            Err($id) => $error,
        }
    };

    ($value: expr, $error: block) => {
        match $crate::unwrap::_into_result($value) {
            Ok(value) => value,
            Err(_error) => $error,
        }
    }

}
