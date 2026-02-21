use std::path::Path;
use std::sync::Arc;
use zarrs::array::{data_type, Array, ArrayBuilder};
use zarrs::config::MetadataRetrieveVersion;
use zarrs::group::GroupBuilder;
use zarrs::storage::ReadableWritableListableStorageTraits;
use zarrs::filesystem::FilesystemStore;

pub type Store = Arc<FilesystemStore>;

/// Type alias for arrays in the store.
pub type StoreArray = Array<dyn ReadableWritableListableStorageTraits>;

pub fn open_store(root: &Path) -> Result<Store, Box<dyn std::error::Error>> {
    let store = FilesystemStore::new(root)?;
    Ok(Arc::new(store))
}

/// Open a Zarr v3 array. Rejects v2 data.
pub fn open_array(
    store: &Store,
    path: &str,
) -> Result<Array<dyn ReadableWritableListableStorageTraits>, Box<dyn std::error::Error>> {
    let store_trait: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let array = Array::open_opt(store_trait, path, &MetadataRetrieveVersion::V3)?;
    Ok(array)
}

pub fn read_chunk_u16(
    array: &Array<impl zarrs::storage::ReadableStorageTraits + ?Sized + 'static>,
    chunk_indices: &[u64],
) -> Result<Vec<u16>, Box<dyn std::error::Error>> {
    let data = array.retrieve_chunk::<Vec<u16>>(chunk_indices)?;
    Ok(data)
}

pub fn read_chunk_f64(
    array: &Array<impl zarrs::storage::ReadableStorageTraits + ?Sized + 'static>,
    chunk_indices: &[u64],
) -> Result<Vec<f64>, Box<dyn std::error::Error>> {
    let data = array.retrieve_chunk::<Vec<f64>>(chunk_indices)?;
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
    let pos_group = GroupBuilder::new().build(store_trait.clone(), &format!("/pos/{}", pos_id))?;
    pos_group.store_metadata()?;

    let store_trait: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let crop = GroupBuilder::new().build(store_trait, &format!("/pos/{}/crop", pos_id))?;
    crop.store_metadata()?;
    Ok(())
}

pub fn create_array_u16(
    store: &Store,
    path: &str,
    shape: Vec<u64>,
    chunks: Vec<u64>,
    attrs: Option<serde_json::Map<String, serde_json::Value>>,
) -> Result<Array<dyn ReadableWritableListableStorageTraits>, Box<dyn std::error::Error>> {
    let store_trait: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let mut builder = ArrayBuilder::new(shape.clone(), chunks.clone(), data_type::uint16(), 0u16);
    if let Some(a) = attrs {
        builder.attributes(a);
    }
    let array = builder.build(store_trait, path)?;
    array.store_metadata()?;
    Ok(array)
}

pub fn create_array_f64(
    store: &Store,
    path: &str,
    shape: Vec<u64>,
    chunks: Vec<u64>,
    attrs: Option<serde_json::Map<String, serde_json::Value>>,
) -> Result<Array<dyn ReadableWritableListableStorageTraits>, Box<dyn std::error::Error>> {
    let store_trait: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let mut builder = ArrayBuilder::new(shape.clone(), chunks.clone(), data_type::float64(), 0.0f64);
    if let Some(a) = attrs {
        builder.attributes(a);
    }
    let array = builder.build(store_trait, path)?;
    array.store_metadata()?;
    Ok(array)
}

pub fn store_chunk_u16(
    array: &Array<impl zarrs::storage::WritableStorageTraits + ?Sized + 'static>,
    chunk_indices: &[u64],
    data: &[u16],
) -> Result<(), Box<dyn std::error::Error>> {
    array.store_chunk(chunk_indices, data)?;
    Ok(())
}

pub fn store_chunk_f64(
    array: &Array<impl zarrs::storage::WritableStorageTraits + ?Sized + 'static>,
    chunk_indices: &[u64],
    value: f64,
) -> Result<(), Box<dyn std::error::Error>> {
    array.store_chunk(chunk_indices, &[value])?;
    Ok(())
}
