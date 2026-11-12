use oozextract::Extractor;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::slice;

#[no_mangle]
pub extern "C" fn neuroport_oodle_abi_version() -> u32 {
    1
}

/// Decompress one Oodle stream into a caller-provided output buffer.
/// Returns the decoded byte count, or a negative error code.
/// SAFETY: src/dst must point to buffers valid for the supplied lengths.
#[no_mangle]
pub unsafe extern "C" fn neuroport_oodle_decompress(
    src: *const u8,
    src_len: usize,
    dst: *mut u8,
    dst_len: usize,
) -> i64 {
    if src.is_null() || dst.is_null() || src_len == 0 || dst_len == 0 {
        return -1;
    }

    let result = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: validity and bounds are guaranteed by the caller's C ABI contract.
        let input = unsafe { slice::from_raw_parts(src, src_len) };
        // SAFETY: validity and bounds are guaranteed by the caller's C ABI contract.
        let output = unsafe { slice::from_raw_parts_mut(dst, dst_len) };
        let mut extractor = Extractor::new();
        extractor.read_from_slice(input, output)
    }));

    match result {
        Ok(Ok(count)) => i64::try_from(count).unwrap_or(-2),
        Ok(Err(_)) => -3,
        Err(_) => -4,
    }
}
