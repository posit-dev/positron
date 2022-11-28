
fn main() {

	#[cfg(target_os = "macos")]
	{
		println!("cargo:rustc-link-arg=-undefined");
		println!("cargo:rustc-link-arg=dynamic_lookup");
	}

}
