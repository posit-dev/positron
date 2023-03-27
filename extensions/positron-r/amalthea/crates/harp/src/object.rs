//
// object.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::collections::HashMap;
use std::convert::TryFrom;
use std::ffi::CStr;
use std::ops::Deref;
use std::ops::DerefMut;
use std::os::raw::c_char;
use std::os::raw::c_int;
use std::sync::Once;

use libR_sys::*;
use log::trace;

use crate::error::Error;
use crate::exec::RFunction;
use crate::exec::RFunctionExt;
use crate::protect::RProtect;
use crate::utils::r_assert_length;
use crate::utils::r_assert_type;
use crate::utils::r_typeof;

// Objects are protected using a doubly-linked list,
// allowing for quick insertion and removal of objects.
static PRECIOUS_LIST_ONCE: Once = Once::new();
static mut PRECIOUS_LIST : Option<SEXP> = None;

unsafe fn protect(object: SEXP) -> SEXP {
    // Nothing to do
    if object == R_NilValue {
        return R_NilValue;
    }

    // Protect the incoming object, just in case.
    Rf_protect(object);

    // Initialize the precious list.
    PRECIOUS_LIST_ONCE.call_once(|| {
        let precious_list = Rf_cons(R_NilValue, Rf_cons(R_NilValue, R_NilValue));
        R_PreserveObject(precious_list);
        PRECIOUS_LIST = Some(precious_list);
    });

    let precious_list = PRECIOUS_LIST.unwrap_unchecked();

    // Get references to the head, tail of the current precious list.
    let head = precious_list;
    let tail = CDR(precious_list);

    // The new cell will be inserted between the existing head and tail,
    // so create a new cell referencing the head and tail of the list.
    let cell = Rf_protect(Rf_cons(head, tail));

    // Set the TAG on the cell so the object is protected.
    SET_TAG(cell, object);

    // Point the CDR of the current head to the newly-created cell.
    SETCDR(head, cell);

    // Point the CAR of the current tail to the newly-created cell.
    SETCAR(tail, cell);

    // Clean up the protect stack and return.
    Rf_unprotect(2);

    trace!("Protecting cell:   {:?}", cell);
    return cell;

}

unsafe fn unprotect(cell: SEXP) {

    if cell == R_NilValue {
        return;
    }

    trace!("Unprotecting cell: {:?}", cell);

    // We need to remove the cell from the precious list.
    // The CAR of the cell points to the previous cell in the precious list.
    // The CDR of the cell points to the next cell in the precious list.
    let head = CAR(cell);
    let tail = CDR(cell);

    // Point the head back at the tail.
    SETCDR(head, tail);

    // Point the tail back at the head.
    SETCAR(tail, head);

    // There should now be no references to the cell above, allowing it
    // (and the object it contains) to be cleaned up.
    SET_TAG(cell, R_NilValue);

}

#[derive(Debug)]
pub struct RObject {
    pub sexp: SEXP,
    pub cell: SEXP,
}

pub trait RObjectExt<T> {
    unsafe fn elt(&self, index: T) -> crate::error::Result<RObject>;
}

impl<T: Into<RObject>> RObjectExt<T> for RObject {
    unsafe fn elt(&self, index: T) -> crate::error::Result<RObject> {
        let index: RObject = index.into();
        RFunction::new("base", "[[")
            .add(self.sexp)
            .add(index)
            .call()
    }
}

impl RObject {

    pub unsafe fn new(data: SEXP) -> Self {
        RObject { sexp: data, cell: protect(data) }
    }

    pub fn view(data: SEXP) -> Self {
        RObject { sexp: data, cell: unsafe { R_NilValue } }
    }

    pub fn null() -> Self {
        RObject {
            sexp: unsafe { R_NilValue },
            cell: unsafe { R_NilValue },
        }
    }

    // A helper function that makes '.try_into()' more ergonomic to use.
    pub unsafe fn to<U: TryFrom<RObject, Error = crate::error::Error>>(self) -> Result<U, Error> {
        TryInto::<U>::try_into(self)
    }

}

impl Drop for RObject {
    fn drop(&mut self) {
        unsafe {
            unprotect(self.cell);
        }
    }
}

// RObjects are not inherently thread-safe since they wrap a raw pointer, but we
// allow them to be sent across threads because we require the acquisition of a
// lock on the outer R interpreter (see `r_lock!`) before using them.
unsafe impl Send for RObject {}

impl Deref for RObject {
    type Target = SEXP;
    fn deref(&self) -> &Self::Target {
        &self.sexp
    }
}

impl DerefMut for RObject {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.sexp
    }
}

/// Convert other object types into RObjects.
impl From<SEXP> for RObject {
    fn from(value: SEXP) -> Self {
        unsafe { RObject::new(value) }
    }
}

impl From<()> for RObject {
    fn from(_value: ()) -> Self {
        unsafe {
            RObject::from(R_NilValue)
        }
    }
}

impl From<bool> for RObject {
    fn from(value: bool) -> Self {
        unsafe {
            let value = Rf_ScalarLogical(value as c_int);
            return RObject::new(value);
        }
    }
}

impl From<i32> for RObject {
    fn from(value: i32) -> Self {
        unsafe {
            let value = Rf_ScalarInteger(value as c_int);
            return RObject::new(value);
        }
    }
}

impl From<f64> for RObject {
    fn from(value: f64) -> Self {
        unsafe {
            let value = Rf_ScalarReal(value);
            return RObject::new(value);
        }
    }
}

impl From<&str> for RObject {
    fn from(value: &str) -> Self {
        unsafe {
            let vector = Rf_protect(Rf_allocVector(STRSXP, 1));
            let element = Rf_mkCharLenCE(value.as_ptr() as *mut c_char, value.len() as i32, cetype_t_CE_UTF8);
            SET_STRING_ELT(vector, 0, element);
            Rf_unprotect(1);
            return RObject::new(vector);
        }
    }
}

impl From<String> for RObject {
    fn from(value: String) -> Self {
        value.as_str().into()
    }
}

/// Convert RObject into other types.

impl From<RObject> for SEXP {
    fn from(object: RObject) -> Self {
        object.sexp
    }
}

impl TryFrom<RObject> for Option<bool> {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {
            r_assert_type(*value, &[LGLSXP])?;
            r_assert_length(*value, 1)?;
            let x = *LOGICAL(*value);
            if x == R_NaInt {
                return Ok(None);
            }
            Ok(Some(x != 0))
        }
    }
}

impl TryFrom<RObject> for Option<String> {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {

            let types = &[CHARSXP, STRSXP, SYMSXP];
            let charsexp = match r_typeof(*value) {
                CHARSXP => *value,
                STRSXP => { r_assert_length(*value, 1)?; STRING_ELT(*value, 0) },
                SYMSXP => PRINTNAME(*value),
                _ => return Err(Error::UnexpectedType(r_typeof(*value), types.to_vec())),
            };

            if charsexp == R_NaString {
                return Ok(None);
            }

            let utf8text = Rf_translateCharUTF8(charsexp);
            Ok(Some(CStr::from_ptr(utf8text).to_str()?.to_string()))
        }
    }
}

impl TryFrom<RObject> for Option<i32> {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {
            r_assert_length(*value, 1)?;
            match r_typeof(*value) {
                INTSXP => {
                    let x = INTEGER_ELT(*value, 0);
                    if x == R_NaInt {
                        Ok(None)
                    } else {
                        Ok(Some(x))
                    }
                }
                REALSXP => {
                    let x = REAL_ELT(*value, 0);
                    if R_IsNA(x) != 0 {
                        Ok(None)
                    } else {
                        Ok(Some(x as i32))
                    }
                }
                _ => { Err(Error::UnexpectedType(r_typeof(*value), vec![INTSXP])) }
            }
        }
    }
}

impl TryFrom<RObject> for Option<f64> {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {
            r_assert_length(*value, 1)?;
            match r_typeof(*value) {
                INTSXP => {
                    let x = INTEGER_ELT(*value, 0);
                    if x == R_NaInt {
                        Ok(None)
                    } else {
                        Ok(Some(x as f64))
                    }
                }
                REALSXP => {
                    let x = REAL_ELT(*value, 0);
                    if R_IsNA(x) != 0 {
                        Ok(None)
                    } else {
                        Ok(Some(x))
                    }
                }
                _ => { Err(Error::UnexpectedType(r_typeof(*value), vec![REALSXP])) }
            }
        }
    }
}

impl TryFrom<RObject> for String {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        match Option::<String>::try_from(value)? {
            Some(x) => Ok(x),
            None => Err(Error::MissingValueError)
        }
    }
}

impl TryFrom<RObject> for bool {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        match Option::<bool>::try_from(value)? {
            Some(x) => Ok(x),
            None => Err(Error::MissingValueError)
        }
    }
}

impl TryFrom<RObject> for i32 {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        match Option::<i32>::try_from(value)? {
            Some(x) => Ok(x),
            None => Err(Error::MissingValueError)
        }
    }
}

impl TryFrom<RObject> for f64 {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        match Option::<f64>::try_from(value)? {
            Some(x) => Ok(x),
            None => Err(Error::MissingValueError)
        }
    }
}

impl TryFrom<RObject> for Vec<String> {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {
            r_assert_type(*value, &[STRSXP, NILSXP])?;

            let mut result : Vec<String> = Vec::new();
            let n = Rf_length(*value) as isize ;
            for i in 0..n {
                let charsexp = STRING_ELT(*value, i);
                if charsexp == R_NaString {
                    return Err(Error::MissingValueError);
                }
                let cstr = Rf_translateCharUTF8(charsexp);
                let string = CStr::from_ptr(cstr);
                result.push(string.to_str().unwrap().to_string());
            }

            return Ok(result);
        }
    }
}

pub struct RObjectI32Iterator {
    object: RObject,
    current: isize,
    size: isize
}

impl Iterator for RObjectI32Iterator {
    type Item = Option<i32>;

    fn next(&mut self) -> Option<Self::Item> {
        unsafe {
            self.current += 1;

            if self.current >= self.size {
                None
            } else {
                // TODO: consider GET_REGION() instead of calling INTEGER_ELT() each time
                let value = INTEGER_ELT(self.object.sexp, self.current);
                if value == R_NaInt {
                    Some(None)
                } else {
                    Some(Some(value))
                }
            }
        }
    }
}

impl RObject {
    pub fn i32_iter(&self) -> Result<RObjectI32Iterator, crate::error::Error> {
        Ok(RObjectI32Iterator {
            object: RObject::from(self.sexp),
            current: -1,
            size: unsafe { Rf_xlength(self.sexp) } as isize
        })
    }
}

impl TryFrom<RObject> for Vec<Option<String>> {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {
            r_assert_type(*value, &[STRSXP, NILSXP])?;

            let mut result : Vec<Option<String>> = Vec::new();
            let n = Rf_length(*value);
            for i in 0..n {
                let charsexp = STRING_ELT(*value, i as isize);
                if charsexp == R_NaString {
                    result.push(None);
                } else {
                    let cstr = Rf_translateCharUTF8(charsexp);
                    let string = CStr::from_ptr(cstr);
                    result.push(Some(string.to_str().unwrap().to_string()));
                }
            }
            return Ok(result);
        }
    }
}

impl TryFrom<RObject> for HashMap<String, String> {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {
            r_assert_type(*value, &[STRSXP, VECSXP])?;

            let names = Rf_getAttrib(*value, R_NamesSymbol);
            r_assert_type(names, &[STRSXP])?;

            let mut protect = RProtect::new();
            let value = protect.add(Rf_coerceVector(*value, STRSXP));

            let n = Rf_length(names);
            let mut map = HashMap::<String, String>::with_capacity(n as usize);

            for i in 0..Rf_length(names) {

                // Get access to element pointers.
                let lhs = R_CHAR(STRING_ELT(names, i as isize));
                let rhs = R_CHAR(STRING_ELT(value, i as isize));

                // Create strings.
                let lhs = CStr::from_ptr(lhs).to_str()?;
                let rhs = CStr::from_ptr(rhs).to_str()?;

                map.insert(lhs.to_string(), rhs.to_string());
            }

            Ok(map)
        }
    }
}

#[cfg(test)]
mod tests {
    use libR_sys::*;

    use crate::assert_match;
    use crate::vector::CharacterVector;
    use crate::{r_test, r_char};

    use super::*;

    #[test]
    #[allow(non_snake_case)]
    fn test_tryfrom_RObject_bool() { r_test! {
        assert_match!(
            Option::<bool>::try_from(RObject::from(Rf_ScalarLogical(R_NaInt))),
            Ok(None) => {}
        );
        assert_eq!(
            Option::<bool>::try_from(RObject::from(true)).unwrap(),
            Some(true)
        );
        assert_eq!(
            Option::<bool>::try_from(RObject::from(false)).unwrap(),
            Some(false)
        );
        assert_match!(
            bool::try_from(RObject::from(Rf_ScalarLogical(R_NaInt))),
            Err(Error::MissingValueError) => {}
        );
        assert!(bool::try_from(RObject::from(true)).unwrap());
        assert!(!bool::try_from(RObject::from(false)).unwrap());
    }}


    #[test]
    #[allow(non_snake_case)]
    fn test_tryfrom_RObject_i32() { r_test! {
        assert_match!(
            Option::<i32>::try_from(RObject::from(R_NaInt)),
            Ok(None) => {}
        );
        assert_match!(
            Option::<i32>::try_from(RObject::from(R_NaReal)),
            Ok(None) => {}
        );
        assert_match!(
            Option::<i32>::try_from(RObject::from(42)),
            Ok(Some(x)) => {
                assert_eq!(x, 42)
            }
        );
        assert_match!(
            Option::<i32>::try_from(RObject::from(42.0)),
            Ok(Some(x)) => {
                assert_eq!(x, 42)
            }
        );

        assert_match!(
            i32::try_from(RObject::from(R_NaInt)),
            Err(Error::MissingValueError) => {}
        );
        assert_match!(
            i32::try_from(RObject::from(R_NaReal)),
            Err(Error::MissingValueError) => {}
        );
        assert_match!(
            i32::try_from(RObject::from(42)),
            Ok(x) => {
                assert_eq!(x, 42)
            }
        );
        assert_match!(
            i32::try_from(RObject::from(42.0)),
            Ok(x) => {
                assert_eq!(x, 42)
            }
        );
    }}

    #[test]
    #[allow(non_snake_case)]
    fn test_tryfrom_RObject_f64() { r_test! {
        assert_match!(
            Option::<f64>::try_from(RObject::from(R_NaInt)),
            Ok(None) => {}
        );
        assert_match!(
            Option::<f64>::try_from(RObject::from(R_NaReal)),
            Ok(None) => {}
        );
        assert_match!(
            Option::<f64>::try_from(RObject::from(42)),
            Ok(Some(x)) => {
                assert_eq!(x, 42.0)
            }
        );
        assert_match!(
            Option::<f64>::try_from(RObject::from(42.0)),
            Ok(Some(x)) => {
                assert_eq!(x, 42.0)
            }
        );

        assert_match!(
            f64::try_from(RObject::from(R_NaInt)),
            Err(Error::MissingValueError) => {}
        );
        assert_match!(
            f64::try_from(RObject::from(R_NaReal)),
            Err(Error::MissingValueError) => {}
        );
        assert_match!(
            f64::try_from(RObject::from(42)),
            Ok(x) => {
                assert_eq!(x, 42.0)
            }
        );
        assert_match!(
            f64::try_from(RObject::from(42.0)),
            Ok(x) => {
                assert_eq!(x, 42.0)
            }
        );
    }}


    #[test]
    #[allow(non_snake_case)]
    fn test_tryfrom_RObject_Option_String() { r_test! {
        let s = RObject::from("abc");

        assert_match!(
            Option::<String>::try_from(s),
            Ok(Some(x)) => {
                assert_eq!(x, "abc");
            }
        );

        let s = RObject::from("abc");
        SET_STRING_ELT(*s, 0, R_NaString);
        assert_match!(
            Option::<String>::try_from(s),
            Ok(None) => {}
        );
    }}

    #[test]
    #[allow(non_snake_case)]
    fn test_tryfrom_RObject_String() { r_test! {
        let s = RObject::from("abc");

        assert_match!(
            String::try_from(s),
            Ok(x) => {
                assert_eq!(x, "abc");
            }
        );

        let s = RObject::from("abc");
        SET_STRING_ELT(*s, 0, R_NaString);
        assert_match!(
            String::try_from(s),
            Err(Error::MissingValueError) => {}
        );
    }}

    #[test]
    #[allow(non_snake_case)]
    fn test_tryfrom_RObject_Vec_Option_String() { r_test! {
        let s = RObject::from(Rf_allocVector(STRSXP, 2));
        SET_STRING_ELT(*s, 0, r_char!("abc"));
        SET_STRING_ELT(*s, 1, R_NaString);

        assert_match!(
            Vec::<Option<String>>::try_from(s),
            Ok(mut x) => {
                assert_eq!(x.pop(), Some(None));
                assert_eq!(x.pop(), Some(Some(String::from("abc"))));
                assert_eq!(x.pop(), None);
            }
        );
    }}

    #[test]
    #[allow(non_snake_case)]
    fn test_tryfrom_RObject_Vec_String() { r_test! {
        let s = RObject::from(Rf_allocVector(STRSXP, 2));
        SET_STRING_ELT(*s, 0, r_char!("abc"));
        SET_STRING_ELT(*s, 1, R_NaString);

        assert_match!(
            Vec::<String>::try_from(s),
            Err(Error::MissingValueError) => {}
        );
    }}

    #[test]
    #[allow(non_snake_case)]
    fn test_RObject_from_Vec_str() { r_test! {
        let expected = ["Apple", "Orange", "한"];
        let vector = CharacterVector::create(&expected);
        assert_eq!(vector.get(0).unwrap(), "Apple".to_string());
        assert_eq!(vector.get(1).unwrap(), "Orange".to_string());
        assert_eq!(vector.get(2).unwrap(), "한".to_string());
    }}

    #[test]
    fn test_r_strings() { r_test! {

        let alphabet = ["a", "b", "c"];

        // &[&str]
        let s = CharacterVector::create(&alphabet);
        assert_eq!(r_typeof(*s), STRSXP);
        assert_eq!(s, alphabet);

        // &[&str; N]
        let s = CharacterVector::create(&alphabet[..]);
        assert_eq!(r_typeof(*s), STRSXP);
        assert_eq!(s, alphabet);

        // Vec<String>
        let s = CharacterVector::create(alphabet.to_vec());
        assert_eq!(r_typeof(*s), STRSXP);
        assert_eq!(s, alphabet);

    }}

}
