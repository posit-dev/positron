//
// join.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

pub trait Joined<T> {
    fn joined(self, delimiter: impl AsRef<str>) -> String;
}

impl<T> Joined<T> for &[T]
where
    T: AsRef<str>,
{
    fn joined(self, delimiter: impl AsRef<str>) -> String {
        let mut buffer = String::new();

        let mut it = self.iter();
        match it.next() {
            None => return buffer,
            Some(el) => buffer.push_str(el.as_ref()),
        }

        let delimiter = delimiter.as_ref();
        loop {
            match it.next() {
                None => break,
                Some(el) => {
                    buffer.push_str(delimiter);
                    buffer.push_str(el.as_ref());
                },
            }
        }

        buffer
    }
}

impl<T> Joined<T> for Vec<T>
where
    T: AsRef<str>,
{
    fn joined(self, delimiter: impl AsRef<str>) -> String {
        self.as_slice().joined(delimiter)
    }
}

#[macro_export]
macro_rules! join {

    ($($value:expr),*) => {{

        // determine required length for string
        let mut len = 0;
        $(
            len += AsRef::<str>::as_ref(&$value).len();
        )*

        // create a buffer to hold the string
        let mut result = String::with_capacity(len);
        $(
            result.push_str($value.as_ref());
        )*

        // use that result value
        result

    }}

}

#[cfg(test)]
mod tests {
    use crate::Joined;

    #[test]
    fn test_join() {
        assert_eq!(join!("abc"), "abc");
        assert_eq!(join!("abc", "def"), "abcdef");
        assert_eq!(join!("abc".to_string(), "def"), "abcdef");

        let a = "a";
        let c = "c";
        assert_eq!(join!(a, "b", c, "d", "e", "f"), "abcdef");

        assert_eq!(["a", "b", "c"].joined(", "), "a, b, c");
    }
}
