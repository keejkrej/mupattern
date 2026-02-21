import { useState, useCallback } from "react";
import { useZarrStore } from "@/see/hooks/useZarrStore";
import { Viewer } from "@/see/components/Viewer";
import { Landing } from "@/see/components/Landing";
import { MovieTaskConfigModal } from "@/tasks/components/MovieTaskConfigModal";
import { createMovieTask } from "@/tasks/lib/create-movie-task";

export default function SeeApp() {
  const { store, index, loading, error, activeWorkspace } = useZarrStore();
  const [movieModalOpen, setMovieModalOpen] = useState(false);
  const [initialMoviePos, setInitialMoviePos] = useState<string | undefined>();
  const [initialMovieCrop, setInitialMovieCrop] = useState<string | undefined>();

  const handleOpenMovieModal = useCallback((pos: string, cropId: string) => {
    setInitialMoviePos(pos);
    setInitialMovieCrop(cropId);
    setMovieModalOpen(true);
  }, []);

  const handleCreateMovie = useCallback(
    (params: {
      input_zarr: string;
      pos: number;
      crop: number;
      channel: number;
      time: string;
      output: string;
      fps: number;
      colormap: string;
      spots: string | null;
    }) => {
      void createMovieTask(params);
    },
    [],
  );

  if (store && index) {
    return (
      <>
        <Viewer store={store} index={index} onSaveAsMovie={handleOpenMovieModal} />
        {activeWorkspace && (
          <MovieTaskConfigModal
            key={activeWorkspace.id}
            open={movieModalOpen}
            onClose={() => setMovieModalOpen(false)}
            workspace={activeWorkspace}
            initialPos={initialMoviePos}
            initialCrop={initialMovieCrop}
            onCreate={handleCreateMovie}
          />
        )}
      </>
    );
  }

  return <Landing loading={loading} error={error} />;
}
