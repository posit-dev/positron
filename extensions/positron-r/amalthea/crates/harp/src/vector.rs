//
// vector.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::ffi::CStr;
use std::marker::PhantomData;
use std::ops::Deref;
use std::ops::DerefMut;
use std::slice::Iter;

use libR_sys::*;

use crate::error::Result;
use crate::object::RObject;
use crate::traits::AsSlice;
use crate::traits::Number;
use crate::utils::r_assert_capacity;
use crate::utils::r_assert_type;

#[derive(Debug)]
pub struct Vector<const SEXPTYPE: u32, NativeType> {
    object: RObject,
    phantom: PhantomData<NativeType>,
}

// Useful type aliases for clients.
pub type RawVector = Vector<RAWSXP, u8>;
pub type LogicalVector = Vector<LGLSXP, i32>;
pub type IntegerVector = Vector<INTSXP, i32>;
pub type NumericVector = Vector<REALSXP, f64>;
pub type CharacterVector = Vector<STRSXP, &'static str>;

// Methods common to all R vectors.
impl<const SEXPTYPE: u32, NativeType> Vector<{ SEXPTYPE }, NativeType> {
    pub unsafe fn new(object: impl Into<SEXP>) -> Result<Self> {
        let object = object.into();
        r_assert_type(object, &[SEXPTYPE])?;
        Ok(Self::new_unchecked(object))
    }

    unsafe fn new_unchecked(object: impl Into<SEXP>) -> Self {
        let object = RObject::new(object.into());
        Self { object, phantom: PhantomData }
    }

    pub unsafe fn with_length(size: usize) -> Self {
        let data = Rf_allocVector(SEXPTYPE, size as isize);
        Self::new_unchecked(data)
    }

    // SAFETY: Rf_length() might allocate for ALTREP objects,
    // so users should be holding the R runtime lock.
    pub unsafe fn len(&self) -> usize {
        Rf_length(*self.object) as usize
    }

    pub fn cast(self) -> RObject {
        self.object
    }

    pub fn data(&self) -> SEXP {
        self.object.sexp
    }
}

// Methods for vectors with primitive native types.
impl<const SEXPTYPE: u32, NativeType> Vector<{ SEXPTYPE }, NativeType>
where
    NativeType: Number + Copy,
{
    pub unsafe fn create<T: AsSlice<NativeType>>(data: T) -> Self {
        let data = data.as_slice();
        let vector = Vector::with_length(data.len());
        let pointer = DATAPTR(*vector) as *mut NativeType;
        pointer.copy_from(data.as_ptr(), data.len());
        vector
    }

    pub fn get(&self, index: isize) -> Result<NativeType> {
        unsafe {
            r_assert_capacity(self.data(), index as u32)?;
            Ok(self.get_unchecked(index))
        }
    }

    pub fn get_unchecked(&self, index: isize) -> NativeType {
        unsafe {
            let pointer = DATAPTR(*self.object) as *mut NativeType;
            let offset = pointer.offset(index);
            *offset
        }
    }

    pub fn iter(&self) -> Iter<'_, NativeType> {
        unsafe {
            let data = DATAPTR(*self.object) as *mut NativeType;
            let len = self.len();
            let slice = std::slice::from_raw_parts(data, len);
            slice.iter()
        }
    }

    pub fn into_vec(self) -> Vec<NativeType> {
        self.into_iter().map(|value| *value).collect::<Vec<_>>()
    }
}

// Character vectors.
pub struct CharacterVectorIterator<'a> {
    data: &'a CharacterVector,
    index: usize,
    size: usize,
}

impl<'a> CharacterVectorIterator<'a> {

    pub fn new(data: &'a CharacterVector) -> Self {
        unsafe {
            Self { data, index: 0, size: data.len() }
        }
    }
}

impl<'a> Iterator for CharacterVectorIterator<'a> {
    type Item = &'static str;

    fn next(&mut self) -> Option<Self::Item> {
        unsafe {
            if self.index == self.size {
                None
            } else {
                let value = self.data.get_unchecked(self.index);
                self.index = self.index + 1;
                Some(value)
            }
        }
    }
}

impl CharacterVector {

    pub unsafe fn create<T>(data: T) -> Self
    where
        T: IntoIterator,
        <T as IntoIterator>::IntoIter: ExactSizeIterator,
        <T as IntoIterator>::Item: AsRef<str>,
    {
        // convert into iterator
        let mut data = data.into_iter();

        // build our character vector
        let n = data.len();
        let vector = CharacterVector::with_length(n);
        for i in 0..data.len() {
            let value = data.next().unwrap_unchecked();
            let value = value.as_ref();
            let charsexp = Rf_mkCharLenCE(
                value.as_ptr() as *const i8,
                value.len() as i32,
                cetype_t_CE_UTF8,
            );
            SET_STRING_ELT(*vector, i as R_xlen_t, charsexp);
        }
        vector
    }

    pub unsafe fn get(&self, index: usize) -> Result<&'static str> {
        r_assert_capacity(self.data(), index as u32)?;
        Ok(self.get_unchecked(index))
    }

    pub unsafe fn get_unchecked(&self, index: usize) -> &'static str {
        let data = *self.object;
        let cstr = Rf_translateCharUTF8(STRING_ELT(data, index as R_xlen_t));
        let bytes = CStr::from_ptr(cstr).to_bytes();
        std::str::from_utf8_unchecked(bytes)
    }

    pub fn iter(&self) -> CharacterVectorIterator {
        CharacterVectorIterator::new(self)
    }

}

// Traits.
impl<const SEXPTYPE: u32, NativeType> Deref
    for Vector<{ SEXPTYPE }, NativeType>
{
    type Target = SEXP;

    fn deref(&self) -> &Self::Target {
        &*self.object
    }
}

impl<const SEXPTYPE: u32, NativeType> DerefMut
    for Vector<{ SEXPTYPE }, NativeType>
{
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut *self.object
    }
}

impl<'a, T, const SEXPTYPE: u32, NativeType> PartialEq<T>
    for Vector<{ SEXPTYPE }, NativeType>
    where
        T: AsSlice<NativeType>,
        NativeType: Number + PartialEq,
{
    fn eq(&self, other: &T) -> bool {
        unsafe {
            let other = other.as_slice();
            if self.len() != other.len() {
                return false;
            }
            let pointer = DATAPTR(self.data()) as *mut NativeType;
            for i in 0..self.len() {
                let value = pointer.offset(i as isize);
                if (*value) != (*other.get_unchecked(i)) {
                    return false;
                }
            }
            true
        }
    }
}

impl<'a, T> PartialEq<T> for CharacterVector
    where T: AsSlice<&'a str>
{
    fn eq(&self, other: &T) -> bool {
        unsafe {
            let other = other.as_slice();
            if self.len() != other.len() {
                return false;
            }

            for i in 0..self.len() {
                let value = self.get_unchecked(i);
                if value != other[i] {
                    return false;
                }
            }

            true

        }
    }
}

impl<'a, const SEXPTYPE: u32, NativeType> IntoIterator
    for &'a Vector<{ SEXPTYPE }, NativeType>
    where NativeType: Number
{
    type Item = &'a NativeType;
    type IntoIter = std::slice::Iter<'a, NativeType>;

    fn into_iter(self) -> Self::IntoIter {
        unsafe {
            let data = DATAPTR(self.data()) as *mut NativeType;
            let slice = std::slice::from_raw_parts(data, self.len());
            slice.iter()
        }
    }
}


// NOTE (Kevin): I previously tried providing 'From' implementations here,
// but had too much trouble bumping into the From and TryFrom blanket
// implementations.
//
// https://github.com/rust-lang/rust/issues/50133
//
// For that reason, I avoid using 'from()' and instead have methods like 'create()'.
// Leaving this code around for now, in case we decide to re-visit.
//
// impl<const SEXPTYPE: u32, NativeType, T> From<T>
//     for Vector<{ SEXPTYPE }, NativeType>
//     where
//         T: AsSlice<NativeType> + Copy,
//         NativeType: Number,
// {
//     fn from(array: T) -> Self {
//         unsafe {
//
//             let array = array.as_slice();
//             let object = Rf_allocVector(SEXPTYPE, array.len() as isize);
//             let pointer = DATAPTR(object) as *mut NativeType;
//             pointer.copy_from(array.as_ptr(), array.len());
//
//             let object = RObject::new(object);
//             Vector::new_unchecked(object)
//         }
//     }
// }
//
// impl<const SEXPTYPE: u32, NativeType> TryFrom<RObject>
//     for Vector<{ SEXPTYPE }, NativeType>
// {
//     type Error = crate::error::Error;
//
//     fn try_from(value: RObject) -> std::result::Result<Self, Self::Error> {
//         Vector::new(value)
//     }
//
// }
//
// impl<const SEXPTYPE: u32, NativeType> Into<RObject>
//     for Vector<{ SEXPTYPE }, NativeType>
// {
//     fn into(self) -> RObject {
//         self.object
//     }
// }
//
// impl<'a, T: AsSlice<&'a str>> From<T> for CharacterVector {
//     fn from(value: T) -> Self {
//         unsafe {
//             CharacterVector::create(value)
//         }
//     }
// }

#[cfg(test)]
mod tests {
    use crate::r_test;
    use crate::vector::CharacterVector;
    use crate::vector::IntegerVector;
    use crate::vector::NumericVector;

    #[test]
    fn test_numeric_vector() {
        r_test! {

            let vector = NumericVector::create([1.0, 2.0, 3.0]);
            assert!(vector.len() == 3);
            assert!(vector.get_unchecked(0) == 1.0);
            assert!(vector.get_unchecked(1) == 2.0);
            assert!(vector.get_unchecked(2) == 3.0);

            let data = [1.0, 2.0, 3.0];
            assert!(vector == data);

            let data = &[1.0, 2.0, 3.0];
            assert!(vector == data);

            let slice = &data[..];
            assert!(vector == slice);

            let mut it = vector.iter();
            let value = it.next();
            assert!(value.is_some());
            assert!(value.unwrap() == &1.0);

            let value = it.next();
            assert!(value.is_some());
            assert!(value.unwrap() == &2.0);

            let value = it.next();
            assert!(value.is_some());
            assert!(value.unwrap() == &3.0);

            let value = it.next();
            assert!(value.is_none());

        }
    }

    #[test]
    fn test_character_vector() {
        r_test! {

            let vector = CharacterVector::create(&["hello", "world"]);
            assert!(vector == ["hello", "world"]);
            assert!(vector == &["hello", "world"]);

            let mut it = vector.iter();

            let value = it.next();
            assert!(value.is_some());
            assert!(value.unwrap() == "hello");

            let value = it.next();
            assert!(value.is_some());
            assert!(value.unwrap() == "world");

            let value = it.next();
            assert!(value.is_none());

            let vector = CharacterVector::create([
                "hello".to_string(),
                "world".to_string()
            ]);

            assert!(vector.get_unchecked(0) == "hello");
            assert!(vector.get_unchecked(1) == "world");

        }
    }

    #[test]
    fn test_integer_vector() {
        r_test! {
            let vector = IntegerVector::create(42);
            assert!(vector.len() == 1);
            assert!(vector.get_unchecked(0) == 42);
        }
    }
}
