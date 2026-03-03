use std::cell::RefCell;
use std::time::Duration;

use indicatif::{ProgressBar, ProgressStyle};

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

thread_local! {
    static CLI_PROGRESS_BAR: RefCell<Option<ProgressBar>> = RefCell::new(None);
}

pub fn stderr_progress(progress: f64, message: &str) {
    let mut message = message.replace('\n', " ");
    if message.len() > 60 {
        message.truncate(57);
        message.push_str("...");
    }
    let ratio = progress.clamp(0.0, 1.0);
    let position = (ratio * 100.0).round() as u64;

    CLI_PROGRESS_BAR.with(|slot| {
        let mut state = slot.borrow_mut();
        if ratio == 0.0 && position == 0 {
            *state = None;
        }

        let bar = state.get_or_insert_with(|| {
            let bar = ProgressBar::new(100);
            let style = ProgressStyle::default_bar()
                .template("{bar:24.green/blue} {percent:>5.1}% {msg}")
                .unwrap_or_else(|_| ProgressStyle::default_bar());
            bar.set_style(style);
            bar.enable_steady_tick(Duration::from_millis(80));
            bar
        });
        bar.set_message(message);
        bar.set_position(position);

        if ratio >= 1.0 {
            bar.finish_with_message("done");
            *state = None;
        }
    });
}
