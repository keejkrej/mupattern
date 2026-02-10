"""mufile GUI – CustomTkinter application."""

from __future__ import annotations

import threading
import tkinter.filedialog as fd
from pathlib import Path

import customtkinter as ctk

from .core import run_convert, run_crop, run_movie

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")


def _browse_dir(parent: ctk.CTkFrame, entry: ctk.CTkEntry, title: str = "Select directory") -> None:
    path = fd.askdirectory(title=title, parent=parent)
    if path:
        entry.delete(0, "end")
        entry.insert(0, path)


def _browse_file(
    parent: ctk.CTkFrame, entry: ctk.CTkEntry, title: str = "Select file", filetypes: list[tuple[str, str]] | None = None
) -> None:
    path = fd.askopenfilename(title=title, parent=parent, filetypes=filetypes)
    if path:
        entry.delete(0, "end")
        entry.insert(0, path)


def _browse_file_save(
    parent: ctk.CTkFrame, entry: ctk.CTkEntry, title: str = "Save file", filetypes: list[tuple[str, str]] | None = None
) -> None:
    path = fd.asksaveasfilename(title=title, parent=parent, filetypes=filetypes, defaultextension=".mp4")
    if path:
        entry.delete(0, "end")
        entry.insert(0, path)


def _run_in_thread(func, *args, on_done=None, **kwargs):
    kwargs_for_func = {k: v for k, v in kwargs.items() if k != "on_done"}
    on_done_cb = on_done

    def run():
        try:
            func(*args, **kwargs_for_func)
        except Exception as e:
            if on_done_cb:
                on_done_cb(str(e), error=True)
        else:
            if on_done_cb:
                on_done_cb("Done.", error=False)

    t = threading.Thread(target=run, daemon=True)
    t.start()


class MufileGUI(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("mufile")
        self.geometry("640x700")
        self.minsize(500, 500)

        self.log_text = ctk.CTkTextbox(self, height=120, state="disabled")
        self.progress_bar = ctk.CTkProgressBar(self)
        self.progress_bar.set(0)
        self.progress_label = ctk.CTkLabel(self, text="")

        top = ctk.CTkFrame(self, fg_color="transparent")
        top.pack(fill="x", padx=20, pady=(20, 0))
        ctk.CTkLabel(top, text="mufile", font=ctk.CTkFont(size=20)).pack(side="left")
        self.theme_btn = ctk.CTkButton(top, text="Light", width=60, command=self._toggle_theme)
        self.theme_btn.pack(side="right")

        self.tabview = ctk.CTkTabview(self)
        self.tabview.add("Crop")
        self.tabview.add("Convert")
        self.tabview.add("Movie")

        self._build_crop_tab()
        self._build_convert_tab()
        self._build_movie_tab()

        self.progress_bar.pack(fill="x", padx=20, pady=(20, 4))
        self.progress_label.pack(anchor="w", padx=20, pady=(0, 4))
        self.log_text.pack(fill="both", expand=True, padx=20, pady=(0, 20))

    def _log(self, msg: str, error: bool = False) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", msg + "\n")
        if error:
            self.log_text.insert("end", "")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _toggle_theme(self) -> None:
        mode = ctk.get_appearance_mode()
        new_mode = "Light" if mode == "Dark" else "Dark"
        ctk.set_appearance_mode(new_mode)
        self.theme_btn.configure(text=new_mode)

    def _progress_callback(self, progress: float, message: str) -> None:
        self.after(0, lambda: self._update_progress(progress, message))

    def _update_progress(self, progress: float, message: str) -> None:
        self.progress_bar.set(progress)
        self.progress_label.configure(text=message)
        self._log(message)

    def _build_crop_tab(self) -> None:
        tab = self.tabview.tab("Crop")
        row = 0

        def add_row(label: str, widget) -> ctk.CTkBaseClass:
            nonlocal row
            lbl = ctk.CTkLabel(tab, text=label, anchor="w")
            lbl.grid(row=row, column=0, sticky="w", padx=10, pady=6)
            widget.grid(row=row, column=1, sticky="ew", padx=10, pady=6)
            row += 1
            return widget

        tab.columnconfigure(1, weight=1)

        self.crop_input_dir = ctk.CTkEntry(tab, placeholder_text="Root folder with Pos* subdirs")
        add_row("Input dir:", self.crop_input_dir)
        btn_in = ctk.CTkButton(tab, text="Browse", width=80, command=lambda: _browse_dir(tab, self.crop_input_dir))
        btn_in.grid(row=row - 1, column=2, padx=10, pady=6)

        self.crop_pos = ctk.CTkEntry(tab, placeholder_text="e.g. 150")
        add_row("Position:", self.crop_pos)

        self.crop_bbox = ctk.CTkEntry(tab, placeholder_text="Bounding box CSV")
        add_row("Bbox CSV:", self.crop_bbox)
        btn_bbox = ctk.CTkButton(tab, text="Browse", width=80, command=lambda: _browse_file(tab, self.crop_bbox))
        btn_bbox.grid(row=row - 1, column=2, padx=10, pady=6)

        self.crop_output = ctk.CTkEntry(tab, placeholder_text="crops.zarr")
        add_row("Output:", self.crop_output)
        btn_out = ctk.CTkButton(tab, text="Browse", width=80, command=lambda: _browse_dir(tab, self.crop_output, "Output directory"))
        btn_out.grid(row=row - 1, column=2, padx=10, pady=6)

        self.crop_background = ctk.CTkCheckBox(tab, text="Compute background (median outside crops)")
        self.crop_background.grid(row=row, column=0, columnspan=2, sticky="w", padx=10, pady=6)
        row += 1

        def run_crop_cmd():
            input_dir = self.crop_input_dir.get().strip()
            pos_s = self.crop_pos.get().strip()
            bbox_s = self.crop_bbox.get().strip()
            output_s = self.crop_output.get().strip()
            if not all([input_dir, pos_s, bbox_s, output_s]):
                self._log("Fill all required fields: input dir, position, bbox CSV, output.", error=True)
                return
            try:
                pos = int(pos_s)
            except ValueError:
                self._log("Position must be an integer.", error=True)
                return
            input_dir = Path(input_dir)
            bbox = Path(bbox_s)
            output = Path(output_s)
            background = self.crop_background.get()
            self.progress_bar.set(0)
            self.progress_label.configure(text="")
            self._log("--- Crop ---")

            def on_done(msg: str, error: bool):
                self.after(0, lambda: self._done_callback(msg, error))

            _run_in_thread(
                run_crop,
                input_dir,
                pos,
                bbox,
                output,
                background,
                on_progress=self._progress_callback,
                on_done=on_done,
            )

        ctk.CTkButton(tab, text="Run Crop", command=run_crop_cmd).grid(row=row, column=0, columnspan=2, pady=20)
        row += 1

    def _build_convert_tab(self) -> None:
        tab = self.tabview.tab("Convert")
        row = 0
        tab.columnconfigure(1, weight=1)

        def add_row(label: str, widget) -> ctk.CTkBaseClass:
            nonlocal row
            lbl = ctk.CTkLabel(tab, text=label, anchor="w")
            lbl.grid(row=row, column=0, sticky="w", padx=10, pady=6)
            widget.grid(row=row, column=1, sticky="ew", padx=10, pady=6)
            row += 1
            return widget

        self.convert_input = ctk.CTkEntry(tab, placeholder_text="Path to .nd2 file")
        add_row("ND2 file:", self.convert_input)
        btn = ctk.CTkButton(
            tab, text="Browse", width=80, command=lambda: _browse_file(tab, self.convert_input, filetypes=[("ND2", "*.nd2")])
        )
        btn.grid(row=row - 1, column=2, padx=10, pady=6)

        self.convert_pos = ctk.CTkEntry(tab, placeholder_text="all or 0:5, 10")
        add_row("Positions:", self.convert_pos)

        self.convert_time = ctk.CTkEntry(tab, placeholder_text="all or 0:50, 100")
        add_row("Timepoints:", self.convert_time)

        self.convert_output = ctk.CTkEntry(tab, placeholder_text="Output directory")
        add_row("Output dir:", self.convert_output)
        btn_out = ctk.CTkButton(tab, text="Browse", width=80, command=lambda: _browse_dir(tab, self.convert_output))
        btn_out.grid(row=row - 1, column=2, padx=10, pady=6)

        def run_convert_cmd():
            input_s = self.convert_input.get().strip()
            output_s = self.convert_output.get().strip()
            if not input_s or not output_s:
                self._log("Fill input ND2 path and output directory.", error=True)
                return
            input_nd2 = Path(input_s)
            output = Path(output_s)
            pos_slice = self.convert_pos.get().strip() or "all"
            time_slice = self.convert_time.get().strip() or "all"
            self.progress_bar.set(0)
            self.progress_label.configure(text="")
            self._log("--- Convert ---")

            def on_done(msg: str, error: bool):
                self.after(0, lambda: self._done_callback(msg, error))

            _run_in_thread(
                run_convert,
                input_nd2,
                pos_slice,
                time_slice,
                output,
                on_progress=self._progress_callback,
                on_done=on_done,
            )

        ctk.CTkButton(tab, text="Run Convert", command=run_convert_cmd).grid(row=row, column=0, columnspan=2, pady=20)
        row += 1

    def _build_movie_tab(self) -> None:
        tab = self.tabview.tab("Movie")
        row = 0
        tab.columnconfigure(1, weight=1)

        def add_row(label: str, widget) -> ctk.CTkBaseClass:
            nonlocal row
            lbl = ctk.CTkLabel(tab, text=label, anchor="w")
            lbl.grid(row=row, column=0, sticky="w", padx=10, pady=6)
            widget.grid(row=row, column=1, sticky="ew", padx=10, pady=6)
            row += 1
            return widget

        self.movie_input = ctk.CTkEntry(tab, placeholder_text="Path to zarr store")
        add_row("Zarr path:", self.movie_input)
        ctk.CTkButton(tab, text="Browse", width=80, command=lambda: _browse_dir(tab, self.movie_input)).grid(
            row=row - 1, column=2, padx=10, pady=6
        )

        self.movie_pos = ctk.CTkEntry(tab, placeholder_text="Position number")
        add_row("Position:", self.movie_pos)

        self.movie_crop = ctk.CTkEntry(tab, placeholder_text="Crop index")
        add_row("Crop:", self.movie_crop)

        self.movie_channel = ctk.CTkEntry(tab, placeholder_text="Channel index")
        add_row("Channel:", self.movie_channel)

        self.movie_time = ctk.CTkEntry(tab, placeholder_text="all or 1:10:2")
        add_row("Timepoints:", self.movie_time)

        self.movie_output = ctk.CTkEntry(tab, placeholder_text="movie.mp4")
        add_row("Output:", self.movie_output)
        ctk.CTkButton(
            tab,
            text="Browse",
            width=80,
            command=lambda: _browse_file_save(tab, self.movie_output, filetypes=[("MP4", "*.mp4")]),
        ).grid(row=row - 1, column=2, padx=10, pady=6)

        self.movie_fps = ctk.CTkEntry(tab, placeholder_text="e.g. 10")
        add_row("FPS:", self.movie_fps)

        self.movie_colormap = ctk.CTkOptionMenu(tab, values=["grayscale", "hot", "viridis"])
        add_row("Colormap:", self.movie_colormap)

        self.movie_spots = ctk.CTkEntry(tab, placeholder_text="Optional spots CSV")
        add_row("Spots CSV:", self.movie_spots)
        ctk.CTkButton(
            tab,
            text="Browse",
            width=80,
            command=lambda: _browse_file(tab, self.movie_spots, filetypes=[("CSV", "*.csv")]),
        ).grid(row=row - 1, column=2, padx=10, pady=6)

        def run_movie_cmd():
            input_s = self.movie_input.get().strip()
            output_s = self.movie_output.get().strip()
            if not input_s or not output_s:
                self._log("Fill zarr path and output path.", error=True)
                return
            try:
                pos = int(self.movie_pos.get().strip())
                crop_idx = int(self.movie_crop.get().strip())
                channel = int(self.movie_channel.get().strip())
                fps = int(self.movie_fps.get().strip() or "10")
            except ValueError:
                self._log("Position, crop, channel, and FPS must be integers.", error=True)
                return
            input_zarr = Path(input_s)
            output = Path(output_s)
            time_slice = self.movie_time.get().strip() or "all"
            colormap = self.movie_colormap.get()
            spots_val = self.movie_spots.get().strip()
            spots_path = Path(spots_val) if spots_val else None
            self.progress_bar.set(0)
            self.progress_label.configure(text="")
            self._log("--- Movie ---")

            def on_done(msg: str, error: bool):
                self.after(0, lambda: self._done_callback(msg, error))

            _run_in_thread(
                run_movie,
                input_zarr,
                pos,
                crop_idx,
                channel,
                time_slice,
                output,
                fps,
                colormap,
                spots_path,
                on_progress=self._progress_callback,
                on_done=on_done,
            )

        ctk.CTkButton(tab, text="Run Movie", command=run_movie_cmd).grid(row=row, column=0, columnspan=2, pady=20)
        row += 1

    def _done_callback(self, msg: str, error: bool) -> None:
        self.progress_bar.set(1.0 if not error else 0)
        self.progress_label.configure(text="")
        self._log(msg, error=error)


def main() -> None:
    app = MufileGUI()
    app.tabview.pack(fill="both", expand=True, padx=20, pady=20)
    app.mainloop()
