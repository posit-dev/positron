//
// join.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

pub fn joined<T: AsRef<str>>(values: &[T], delimiter: &str) -> String {

    let mut buffer = String::new();

    let mut it = values.iter();

    // handle first element
    match it.next() {
        Some(value) => buffer.push_str(value.as_ref()),
        None => return buffer,
    }

    // handle rest
    for value in it {
        buffer.push_str(delimiter);
        buffer.push_str(value.as_ref());
    }

    buffer
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
    #[test]
    fn test_join() {
        assert_eq!(join!("abc", "def"), "abcdef");
        assert_eq!(join!("abc".to_string(), "def"), "abcdef");

        let a = "a";
        let c = "c";
        assert_eq!(join!(a, "b", c, "d", "e", "f"), "abcdef");
    }
}
