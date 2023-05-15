//
// slice.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

pub trait AsSlice<T> {
    fn as_slice(&self) -> &[T];
}

impl<T> AsSlice<T> for T {
    fn as_slice(&self) -> &[T] {
        std::slice::from_ref(self)
    }
}

impl<T> AsSlice<T> for &T {
    fn as_slice(&self) -> &[T] {
        std::slice::from_ref(self)
    }
}

impl<T> AsSlice<T> for [T] {
    fn as_slice(&self) -> &[T] {
        &self[..]
    }
}

impl<T> AsSlice<T> for &[T] {
    fn as_slice(&self) -> &[T] {
        self
    }
}

impl<T, const N: usize> AsSlice<T> for [T; N] {
    fn as_slice(&self) -> &[T] {
        &self[..]
    }
}

impl<T, const N: usize> AsSlice<T> for &[T; N] {
    fn as_slice(&self) -> &[T] {
        &self[..]
    }
}

impl<T> AsSlice<T> for Vec<T> {
    fn as_slice(&self) -> &[T] {
        &self[..]
    }
}

#[cfg(test)]
mod test {

    #[test]
    fn test_slice() {
        let value = ["hello"];
        let slice = value.as_slice();
        assert!(slice.len() == 1);
        assert!(*slice.get(0).unwrap() == "hello");
    }

}


