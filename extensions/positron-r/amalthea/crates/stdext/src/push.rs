//
// push.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

pub trait Push<T> {
    fn push(&mut self, value: T);
}

impl<T: AsRef<str>> Push<T> for String {
    fn push(&mut self, value: T) {
        self.push_str(value.as_ref());
    }
}

impl<T> Push<T> for Vec<T> {
    fn push(&mut self, value: T) {
        self.push(value);
    }
}

#[macro_export]
macro_rules! push {

    ($id:expr, $($value:expr),*) => {{
        use $crate::push::Push;
        $(
            <_ as Push<_>>::push(&mut $id, $value);
        )*
    }}

}

#[cfg(test)]
mod tests {
    #[test]
    fn test_join() {
        let mut buffer = String::new();
        push!(buffer, "abc");
        push!(buffer, "def".to_string());
        assert!(buffer == "abcdef");
    }
}
