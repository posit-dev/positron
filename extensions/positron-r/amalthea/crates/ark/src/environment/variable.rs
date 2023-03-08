//
// variable.rs
//
// Copyright (C) 2023 by Posit Software, PBC
//
//

use harp::object::RObject;
use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EnvironmentVariable {
    /** The environment variable's name */
    name: String,

    /** The environment variable's value kind (string, number, etc.) */
    kind: String,

    /** A formatted representation of the variable's value */
    value: String,
}

impl EnvironmentVariable {
    /**
     * Create a new EnvironmentVariable from a name (environment binding) and a
     * value (R object).
     */
    pub fn new(name: &String, obj: RObject) -> Self {
        // Attempt to convert the object to a string. This only works for string
        // types, so if that fails, just use the name as the "value".
        //
        // TODO: detect the type of the object and support types other than
        // strings.
        let value: String = match obj.try_into() {
            Ok(v) => v,
            Err(_) => name.clone(),
        };
        Self {
            name: name.clone(),
            kind: String::from("String"),
            value,
        }
    }
}
