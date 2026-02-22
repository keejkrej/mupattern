use std::path::Path;
use std::sync::Arc;
use zarrs::array::{data_type, Array, ArrayBuilder};
use zarrs::filesystem::FilesystemStore;
use zarrs::group::GroupBuilder;
use zarrs::storage::ReadableWritableListableStorageTraits;

pub type Store = Arc<FilesystemStore>;
pub type StoreArray = Array<dyn ReadableWritableListableStorageTraits>;

pub fn open_store(root: &Path) -> Result<Store, Box<dyn std::error::Error>> {
    let store = FilesystemStore::new(root)?;
    Ok(Arc::new(store))
}

pub fn ensure_pos_crop_groups(
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
    chunks: Vec<u64>,
    attrs: Option<serde_json::Map<String, serde_json::Value>>,
) -> Result<Array<dyn ReadableWritableListableStorageTraits>, Box<dyn std::error::Error>> {
    let store_trait: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let mut builder = ArrayBuilder::new(shape, chunks, data_type::uint16(), 0u16);
    if let Some(attributes) = attrs {
        builder.attributes(attributes);
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
