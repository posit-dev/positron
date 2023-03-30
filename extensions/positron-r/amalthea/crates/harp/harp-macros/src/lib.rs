//
// lib.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use proc_macro::TokenStream;
use quote::format_ident;
use quote::quote;
use quote::ToTokens;
use syn::ItemStruct;
use syn::parse_macro_input;

extern crate proc_macro;

fn invalid_parameter(stream: impl ToTokens) -> ! {
    panic!(
        "Invalid parameter `{}`: registered routines can only accept SEXP parameters.",
        stream.to_token_stream()
    );
}

fn invalid_return_type(stream: impl ToTokens) -> ! {
    panic!(
        "Invalid return type `{}`: registered routines must return a SEXP.",
        stream.to_token_stream()
    );
}

fn invalid_extern(stream: impl ToTokens) -> ! {
    panic!(
        "Invalid signature `{}`: registered routines must be 'extern \"C\"'.",
        stream.to_token_stream()
    );
}

#[proc_macro_attribute]
pub fn vector(_attr: TokenStream, item: TokenStream) -> TokenStream {

    // TODO: How do we parse an attribute?

    // Parse input as struct.
    let data = parse_macro_input!(item as ItemStruct);

    // Get the name of the struct.
    let ident = data.ident.clone();

    // Include a bunch of derives.
    let all = quote! {

        #[derive(Debug)]
        #data

        impl std::ops::Deref for #ident {
            type Target = SEXP;

            fn deref(&self) -> &Self::Target {
                &self.object.sexp
            }
        }

        impl std::ops::DerefMut for #ident {
            fn deref_mut(&mut self) -> &mut Self::Target {
                &mut self.object.sexp
            }
        }

        impl std::convert::TryFrom<SEXP> for #ident {
            type Error = crate::error::Error;
            fn try_from(value: SEXP) -> Result<Self, Self::Error> {
                unsafe { Self::new(value) }
            }
        }

        pub struct VectorIter<'a> {
            data: &'a #ident,
            index: isize,
            size: isize,
        }

        impl<'a> std::iter::Iterator for VectorIter<'a> {
            type Item = Option<<#ident as Vector>::Type>;

            fn next(&mut self) -> Option<Self::Item> {
                if self.index == self.size {
                    return None;
                }

                // TODO: having the iterator to call get_unchecked()
                //       feels wrong because down the line this will
                //       need to call REAL_ELT(), STRING_ELT() etc ...
                //       which has some extra cost one the R side
                //
                //       This is the opposite problem of calling
                //       DATAPTR() which gives a contiguous array
                //       but has to materialize for it which might be
                //       costly for ALTREP() vectors
                //
                //       The compromise that was used in cpp11 is to use
                //       GET_REGION and work on partial materialization
                let item = unsafe { self.data.get_unchecked(self.index) };
                self.index = self.index + 1;
                Some(item)
            }
        }

        impl #ident {
            pub fn iter(&self) -> VectorIter<'_> {
                let size = unsafe { self.len() as isize };
                VectorIter {
                    data: self,
                    index: 0,
                    size: size,
                }
            }

            pub fn format(&self, sep: &str, max: usize) -> (bool, String)
            {
                let mut out = String::from("");
                let mut truncated = false;
                let mut first = true;
                let mut iter = self.iter();

                while let Some(x) = iter.next() {
                    if max > 0 && out.len() > max {
                        truncated = true;
                        break;
                    }

                    if first {
                        first = false;
                    } else {
                        out.push_str(sep);
                    }

                    match x {
                        Some(value) => {
                            out.push_str(self.format_one(value).as_str());
                        },
                        None => out.push_str("NA")
                    }
                }

                (truncated, out)
            }
        }

        impl<T> std::cmp::PartialEq<T> for #ident
        where
            T: crate::traits::AsSlice<<Self as Vector>::CompareType>
        {
            fn eq(&self, other: &T) -> bool {
                let other: &[<Self as Vector>::CompareType] = other.as_slice();

                let lhs = self.iter();
                let rhs = other.iter();
                let zipped = std::iter::zip(lhs, rhs);
                for (lhs, rhs) in zipped {
                    match lhs {
                        Some(lhs) => {
                            if lhs != *rhs {
                                return false;
                            }
                        }
                        None => {
                            return false;
                        }
                    }

                }

                true

            }
        }

    };

    all.into()

}

#[proc_macro_attribute]
pub fn register(_attr: TokenStream, item: TokenStream) -> TokenStream {
    // Get metadata about the function being registered.
    let function: syn::ItemFn = syn::parse(item).unwrap();

    // Make sure the function is 'extern "C"'.
    let abi = match function.sig.abi {
        Some(ref abi) => abi,
        None => invalid_extern(function.sig),
    };

    let name = match abi.name {
        Some(ref name) => name,
        None => invalid_extern(function.sig),
    };

    let name = name.to_token_stream().to_string();
    if name != "\"C\"" {
        invalid_extern(function.sig);
    }

    // Make sure that the function only accepts SEXPs.
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
        _ => invalid_return_type(function.sig.output),
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

    // Give a name to the registration function.
    let register = format_ident!("_{}_call_method_def", ident);

    // Define a separate function that produces this for us.
    let registration = quote! {

        #[ctor::ctor]
        fn #register() {

            unsafe {
                harp::routines::add(R_CallMethodDef {
                    name: (#name).as_ptr() as *const std::os::raw::c_char,
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
