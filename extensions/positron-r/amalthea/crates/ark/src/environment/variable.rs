//
// variable.rs
//
// Copyright (C) 2023 by Posit Software, PBC
//
//

use harp::object::RObject;
use serde::Deserialize;
use serde::Serialize;

/// Represents the supported kinds of variable values.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ValueKind {
    /// A character vector (string) or value that can be converted to a string
    String,

    /// A numeric value
    Number,

    /// A vector (VECSXP)
    Vector,

    /// A list (LISTSXP)
    List,

    /// A function value
    Function,

    /// Data frame (data.frame, tibble, etc.)
    Dataframe,
    // TODO: Add other types of values. These don't have to map 1-1 to R object
    // types; they represent the kinds of values that have unique UI
    // representations. Note that these value kinds are shared across all
    // languages so they need to be somewhat generic.
}

/// Represents the serialized form of an environment variable.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EnvironmentVariable {
    /** The environment variable's name */
    pub name: String,

    /** The environment variable's value kind (string, number, etc.) */
    pub kind: ValueKind,

    /** A formatted representation of the variable's value */
    pub value: String,
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
        // strings; maybe implment a try_into() method on RObject that formats
        // the object an EnvironmentVariable?
        let value: String = match obj.try_into() {
            Ok(v) => v,
            Err(_) => name.clone(),
        };
        Self {
            name: name.clone(),
            kind: ValueKind::String,
            value,
        }
    }
}
