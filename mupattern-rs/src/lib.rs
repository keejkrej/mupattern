pub mod convert;
pub mod crop;
pub mod expression;
pub mod kill;
pub mod movie;
pub mod rpc;
pub mod slices;
pub mod spot;
pub mod tissue;
pub mod zarr;

pub fn stderr_progress(progress: f64, message: &str) {
    use std::io::{self, Write};
    let _ = writeln!(
        io::stderr(),
        "{}",
        serde_json::json!({"progress": progress, "message": message})
    );
    let _ = io::stderr().flush();
}
