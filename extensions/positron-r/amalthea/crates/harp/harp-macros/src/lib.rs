//
// lib.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use proc_macro::TokenStream;
use quote::ToTokens;
use quote::quote;

extern crate proc_macro;

fn invalid_parameter(stream: impl ToTokens) -> ! {
    panic!("Invalid parameter `{}`: registered routines can only accept SEXP parameters.", stream.to_token_stream());
}

fn invalid_return_type(stream: impl ToTokens) -> ! {
    panic!("Invalid return type `{}`: registered routines must return a SEXP.", stream.to_token_stream());
}

#[proc_macro_attribute]
pub fn register(_attr: TokenStream, item: TokenStream) -> TokenStream {

    // Get metadata about the function being registered.
    let function : syn::ItemFn = syn::parse(item).unwrap();

    // Make sure that the function only accepts SEXPs, and returns a SEXP.
    for input in function.sig.inputs.iter() {

        let pattern = match input {
            syn::FnArg::Typed(pattern) => pattern,
            syn::FnArg::Receiver(receiver) => invalid_parameter(receiver),
        };

        let stream = match *pattern.ty {
            syn::Type::Path(ref stream) => stream,
            _ => invalid_parameter(pattern),
        };

        let value = stream.into_token_stream().to_string();
        if value != "SEXP" {
            invalid_parameter(pattern);
        }

    }

    // Make sure that the function returns a SEXP.
    let ty = match function.sig.output {
        syn::ReturnType::Type(_, ref ty) => ty,
        _ => invalid_return_type(function.sig.output)
    };

    let stream = ty.into_token_stream();
    if stream.to_string() != "SEXP" {
        invalid_return_type(ty);
    }

    // Get the name from the attribute.
    let ident = function.sig.ident.clone();
    let nargs = function.sig.inputs.len() as i32;

    // Get the name (as a C string).
    let mut name = ident.to_string();
    name.push_str("\0");
    let name = syn::LitByteStr::new(name.as_bytes(), ident.span());

    // Define a separate function that produces this for us.
    let registration = quote! {

        #[ctor::ctor]
        fn register() {

            unsafe {
                harp::routines::add(R_CallMethodDef {
                    name: (#name).as_ptr() as *const i8,
                    fun: Some(::std::mem::transmute(#ident as *const ())),
                    numArgs: #nargs
                });
            }

        }

    };

    // Put everything together.
    let all = quote! { #function #registration };
    all.into()

}
