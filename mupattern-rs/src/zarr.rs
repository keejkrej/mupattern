use std::ops::Deref;
use std::path::Path;
use std::sync::Arc;

use zarrs::array::{
    data_type, Array, ArrayBuilder, ArrayShardedExt, ArrayShardedReadableExt,
    ArrayShardedReadableExtCache, ArraySubset, CodecOptions,
};
use zarrs::config::MetadataRetrieveVersion;
use zarrs::filesystem::FilesystemStore;
use zarrs::group::GroupBuilder;
use zarrs::storage::ReadableWritableListableStorageTraits;

pub type Store = Arc<FilesystemStore>;

pub const SHARD_TIME_AXIS: u64 = 64;

pub struct StoreArray {
    array: Array<dyn ReadableWritableListableStorageTraits>,
    shard_cache: ArrayShardedReadableExtCache,
}

impl StoreArray {
    fn new(array: Array<dyn ReadableWritableListableStorageTraits>) -> Self {
        let shard_cache = ArrayShardedReadableExtCache::new(&array);
        Self { array, shard_cache }
    }

    fn chunk_subset(
        &self,
        chunk_indices: &[u64],
    ) -> Result<ArraySubset, Box<dyn std::error::Error>> {
        self.subchunk_grid()
            .subset(chunk_indices)?
            .ok_or_else(|| format!("invalid chunk indices: {chunk_indices:?}").into())
    }
}

impl Deref for StoreArray {
    type Target = Array<dyn ReadableWritableListableStorageTraits>;

    fn deref(&self) -> &Self::Target {
        &self.array
    }
}

pub fn open_store(root: &Path) -> Result<Store, Box<dyn std::error::Error>> {
    let store = FilesystemStore::new(root)?;
    Ok(Arc::new(store))
}

#[must_use]
pub fn shard_shape_t_first(shape: &[u64]) -> Vec<u64> {
    let mut shard_shape = shape.to_vec();
    if let Some(t) = shard_shape.first_mut() {
        *t = (*t).min(SHARD_TIME_AXIS);
    }
    shard_shape
}

/// Open a Zarr v3 array. Rejects v2 data.
pub fn open_array(store: &Store, path: &str) -> Result<StoreArray, Box<dyn std::error::Error>> {
    let store_trait: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let array = Array::open_opt(store_trait, path, &MetadataRetrieveVersion::V3)?;
    Ok(StoreArray::new(array))
}

pub fn read_chunk_u16(
    array: &StoreArray,
    chunk_indices: &[u64],
) -> Result<Vec<u16>, Box<dyn std::error::Error>> {
    let data = array.retrieve_subchunk_opt::<Vec<u16>>(
        &array.shard_cache,
        chunk_indices,
        &CodecOptions::default(),
    )?;
    Ok(data)
}

/// Ensure v3 group hierarchy exists. Creates root, pos, pos/{pos_id}, pos/{pos_id}/crop.
pub(crate) fn ensure_pos_crop_groups(
    store: &Store,
    pos_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let store_trait: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let root = GroupBuilder::new().build(store_trait.clone(), "/")?;
    root.store_metadata()?;

    let store_trait: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let pos = GroupBuilder::new().build(store_trait.clone(), "/pos")?;
    pos.store_metadata()?;

    let store_trait: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let pos_group = GroupBuilder::new().build(store_trait.clone(), &format!("/pos/{pos_id}"))?;
    pos_group.store_metadata()?;

    let store_trait: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let crop = GroupBuilder::new().build(store_trait, &format!("/pos/{pos_id}/crop"))?;
    crop.store_metadata()?;
    Ok(())
}

pub fn create_array_u16(
    store: &Store,
    path: &str,
    shape: Vec<u64>,
    chunk_shape: Vec<u64>,
    shard_shape: Vec<u64>,
    attrs: Option<serde_json::Map<String, serde_json::Value>>,
) -> Result<StoreArray, Box<dyn std::error::Error>> {
    let store_trait: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let mut builder = ArrayBuilder::new(shape, shard_shape, data_type::uint16(), 0u16);
    builder.subchunk_shape(chunk_shape);
    if let Some(a) = attrs {
        builder.attributes(a);
    }
    let array = builder.build(store_trait, path)?;
    array.store_metadata()?;
    Ok(StoreArray::new(array))
}

pub fn store_chunk_u16(
    array: &StoreArray,
    chunk_indices: &[u64],
    data: &[u16],
) -> Result<(), Box<dyn std::error::Error>> {
    let subset = array.chunk_subset(chunk_indices)?;
    array.store_array_subset(&subset, data)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use serde_json::json;
    use tempfile::TempDir;
    use zarrs::array::{data_type, ArrayBuilder};

    use super::*;

    fn repo_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace root")
            .to_path_buf()
    }

    fn metadata_json(
        root: &Path,
        name: &str,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let text = fs::read_to_string(root.join(name).join("zarr.json"))?;
        Ok(serde_json::from_str(&text)?)
    }

    fn python_path() -> Option<PathBuf> {
        let root = repo_root();
        let path = if cfg!(windows) {
            root.join(".venv").join("Scripts").join("python.exe")
        } else {
            root.join(".venv").join("bin").join("python")
        };
        path.exists().then_some(path)
    }

    fn sample_data(len: usize, offset: u16) -> Vec<u16> {
        (0..len).map(|idx| offset + idx as u16).collect()
    }

    fn create_test_array(
        root: &Path,
        name: &str,
        shape: Vec<u64>,
        chunk_shape: Vec<u64>,
    ) -> Result<StoreArray, Box<dyn std::error::Error>> {
        let store = open_store(root)?;
        create_array_u16(
            &store,
            &format!("/{name}"),
            shape.clone(),
            chunk_shape,
            shard_shape_t_first(&shape),
            None,
        )
    }

    fn assert_sharded_metadata(
        root: &Path,
        name: &str,
        expected_shard_shape: serde_json::Value,
        expected_chunk_shape: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let metadata = metadata_json(root, name)?;
        assert_eq!(
            metadata["chunk_grid"]["configuration"]["chunk_shape"],
            expected_shard_shape
        );
        assert_eq!(metadata["codecs"][0]["name"], "sharding_indexed");
        assert_eq!(
            metadata["codecs"][0]["configuration"]["chunk_shape"],
            expected_chunk_shape
        );
        assert_eq!(
            metadata["codecs"][0]["configuration"]["index_codecs"][1]["name"],
            "crc32c"
        );
        Ok(())
    }

    #[test]
    fn crop_background_and_mask_metadata_are_sharded() -> Result<(), Box<dyn std::error::Error>> {
        let dir = TempDir::new()?;
        let crop = create_test_array(
            dir.path(),
            "crop",
            vec![100, 2, 3, 4, 5],
            vec![1, 1, 1, 4, 5],
        )?;
        let background =
            create_test_array(dir.path(), "background", vec![100, 2, 3], vec![1, 1, 1])?;
        let mask = create_test_array(dir.path(), "mask", vec![100, 4, 5], vec![1, 4, 5])?;

        assert!(crop.is_sharded());
        assert!(background.is_sharded());
        assert!(mask.is_sharded());

        assert_eq!(
            crop.subchunk_shape()
                .unwrap()
                .iter()
                .map(|value| value.get())
                .collect::<Vec<_>>(),
            vec![1, 1, 1, 4, 5]
        );
        assert_eq!(
            background
                .subchunk_shape()
                .unwrap()
                .iter()
                .map(|value| value.get())
                .collect::<Vec<_>>(),
            vec![1, 1, 1]
        );
        assert_eq!(
            mask.subchunk_shape()
                .unwrap()
                .iter()
                .map(|value| value.get())
                .collect::<Vec<_>>(),
            vec![1, 4, 5]
        );

        assert_sharded_metadata(
            dir.path(),
            "crop",
            json!([64, 2, 3, 4, 5]),
            json!([1, 1, 1, 4, 5]),
        )?;
        assert_sharded_metadata(
            dir.path(),
            "background",
            json!([64, 2, 3]),
            json!([1, 1, 1]),
        )?;
        assert_sharded_metadata(dir.path(), "mask", json!([64, 4, 5]), json!([1, 4, 5]))?;

        Ok(())
    }

    #[test]
    fn sharded_inner_chunk_round_trip_works_for_crop_background_and_mask(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let dir = TempDir::new()?;
        let crop = create_test_array(
            dir.path(),
            "crop",
            vec![100, 2, 3, 4, 5],
            vec![1, 1, 1, 4, 5],
        )?;
        let crop_data = sample_data(4 * 5, 10);
        store_chunk_u16(&crop, &[70, 1, 2, 0, 0], &crop_data)?;
        assert_eq!(read_chunk_u16(&crop, &[70, 1, 2, 0, 0])?, crop_data);

        let background =
            create_test_array(dir.path(), "background", vec![100, 2, 3], vec![1, 1, 1])?;
        store_chunk_u16(&background, &[70, 1, 2], &[321])?;
        assert_eq!(read_chunk_u16(&background, &[70, 1, 2])?, vec![321]);

        let mask = create_test_array(dir.path(), "mask", vec![100, 4, 5], vec![1, 4, 5])?;
        let mask_data = sample_data(4 * 5, 1000);
        store_chunk_u16(&mask, &[70, 0, 0], &mask_data)?;
        assert_eq!(read_chunk_u16(&mask, &[70, 0, 0])?, mask_data);

        Ok(())
    }

    #[test]
    fn read_chunk_helper_remains_compatible_with_unsharded_arrays(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let dir = TempDir::new()?;
        let store = open_store(dir.path())?;
        let storage: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
        let array = ArrayBuilder::new(
            vec![8, 2, 3, 4, 5],
            vec![1, 1, 1, 4, 5],
            data_type::uint16(),
            0u16,
        )
        .build(storage, "/legacy")?;
        array.store_metadata()?;

        let data = sample_data(4 * 5, 42);
        array.store_chunk(&[3, 1, 2, 0, 0], &data)?;

        let legacy = open_array(&store, "/legacy")?;
        assert!(!legacy.is_sharded());
        assert_eq!(read_chunk_u16(&legacy, &[3, 1, 2, 0, 0])?, data);

        Ok(())
    }

    #[test]
    fn rust_written_sharded_store_is_readable_by_python() -> Result<(), Box<dyn std::error::Error>>
    {
        let Some(python) = python_path() else {
            return Ok(());
        };

        let dir = TempDir::new()?;
        let crop = create_test_array(
            dir.path(),
            "crop",
            vec![100, 2, 3, 4, 5],
            vec![1, 1, 1, 4, 5],
        )?;
        let crop_data = sample_data(4 * 5, 7);
        let expected_sum: u64 = crop_data.iter().map(|&value| value as u64).sum();
        store_chunk_u16(&crop, &[70, 1, 2, 0, 0], &crop_data)?;

        let script = r#"
from pathlib import Path
import sys
import zarr

root = Path(sys.argv[1])
expected_sum = int(sys.argv[2])
arr = zarr.open_array(str(root / "crop"), mode="r", zarr_format=3)
chunk = arr[70, 1, 2]
assert tuple(chunk.shape) == (4, 5)
assert int(chunk.sum()) == expected_sum
"#;
        let status = Command::new(python)
            .current_dir(repo_root())
            .args(["-c", script])
            .arg(dir.path())
            .arg(expected_sum.to_string())
            .status()?;
        assert!(status.success());

        Ok(())
    }

    #[test]
    fn python_written_sharded_store_is_readable_by_rust() -> Result<(), Box<dyn std::error::Error>>
    {
        let Some(python) = python_path() else {
            return Ok(());
        };

        let dir = TempDir::new()?;
        let script = r#"
from pathlib import Path
import sys
import zarr

root = Path(sys.argv[1])
group = zarr.open_group(str(root), mode="a", zarr_format=3)
arr = group.create_array(
    "crop",
    shape=(100, 2, 3, 4, 5),
    chunks=(1, 1, 1, 4, 5),
    shards=(64, 2, 3, 4, 5),
    dtype="u2",
    fill_value=0,
    overwrite=True,
)
arr[70, 1, 2] = [[500 + row * 5 + col for col in range(5)] for row in range(4)]
"#;
        let status = Command::new(python)
            .current_dir(repo_root())
            .args(["-c", script])
            .arg(dir.path())
            .status()?;
        assert!(status.success());

        let store = open_store(dir.path())?;
        let crop = open_array(&store, "/crop")?;
        assert!(crop.is_sharded());
        assert_eq!(
            read_chunk_u16(&crop, &[70, 1, 2, 0, 0])?,
            sample_data(4 * 5, 500)
        );

        Ok(())
    }
}
