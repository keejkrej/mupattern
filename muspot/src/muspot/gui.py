"""muspot GUI – CustomTkinter application."""

from __future__ import annotations

import threading
import tkinter.filedialog as fd
from pathlib import Path

import customtkinter as ctk

from .core import run_detect, run_plot

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
    path = fd.asksaveasfilename(title=title, parent=parent, filetypes=filetypes)
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


class MuspotGUI(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("muspot")
        self.geometry("560x550")
        self.minsize(450, 450)

        self.log_text = ctk.CTkTextbox(self, height=100, state="disabled")
        self.progress_bar = ctk.CTkProgressBar(self)
        self.progress_bar.set(0)
        self.progress_label = ctk.CTkLabel(self, text="")

        top = ctk.CTkFrame(self, fg_color="transparent")
        top.pack(fill="x", padx=20, pady=(20, 0))
        ctk.CTkLabel(top, text="muspot", font=ctk.CTkFont(size=20)).pack(side="left")
        self.theme_btn = ctk.CTkButton(top, text="Light", width=60, command=self._toggle_theme)
        self.theme_btn.pack(side="right")

        self.tabview = ctk.CTkTabview(self)
        self.tabview.add("Detect")
        self.tabview.add("Plot")

        self._build_detect_tab()
        self._build_plot_tab()

        self.progress_bar.pack(fill="x", padx=20, pady=(20, 4))
        self.progress_label.pack(anchor="w", padx=20, pady=(0, 4))
        self.log_text.pack(fill="both", expand=True, padx=20, pady=(0, 20))

    def _log(self, msg: str, error: bool = False) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", msg + "\n")
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

    def _done_callback(self, msg: str, error: bool) -> None:
        self.progress_bar.set(1.0 if not error else 0)
        self.progress_label.configure(text="")
        self._log(msg, error=error)

    def _build_detect_tab(self) -> None:
        tab = self.tabview.tab("Detect")
        tab.columnconfigure(1, weight=1)
        row = 0

        def add_row(label: str, widget):
            nonlocal row
            ctk.CTkLabel(tab, text=label, anchor="w").grid(row=row, column=0, sticky="w", padx=10, pady=6)
            widget.grid(row=row, column=1, sticky="ew", padx=10, pady=6)
            row += 1

        self.detect_zarr = ctk.CTkEntry(tab, placeholder_text="Path to crops.zarr")
        add_row("Zarr path:", self.detect_zarr)
        ctk.CTkButton(tab, text="Browse", width=80, command=lambda: _browse_dir(tab, self.detect_zarr)).grid(
            row=row - 1, column=2, padx=10, pady=6
        )

        self.detect_pos = ctk.CTkEntry(tab, placeholder_text="Position number")
        add_row("Position:", self.detect_pos)

        self.detect_channel = ctk.CTkEntry(tab, placeholder_text="Channel index")
        add_row("Channel:", self.detect_channel)

        self.detect_crop = ctk.CTkEntry(tab, placeholder_text="all or 0:10, 15")
        add_row("Crops:", self.detect_crop)

        self.detect_model = ctk.CTkEntry(tab, placeholder_text="general")
        add_row("Model:", self.detect_model)

        self.detect_output = ctk.CTkEntry(tab, placeholder_text="spots.csv")
        add_row("Output:", self.detect_output)
        ctk.CTkButton(
            tab,
            text="Browse",
            width=80,
            command=lambda: _browse_file_save(tab, self.detect_output, filetypes=[("CSV", "*.csv")]),
        ).grid(row=row - 1, column=2, padx=10, pady=6)

        def run_detect_cmd():
            zarr_s = self.detect_zarr.get().strip()
            output_s = self.detect_output.get().strip()
            if not zarr_s or not output_s:
                self._log("Fill zarr path and output path.", error=True)
                return
            try:
                pos = int(self.detect_pos.get().strip())
                channel = int(self.detect_channel.get().strip())
            except ValueError:
                self._log("Position and channel must be integers.", error=True)
                return
            crop_slice = self.detect_crop.get().strip() or "all"
            model = self.detect_model.get().strip() or "general"
            self.progress_bar.set(0)
            self.progress_label.configure(text="")
            self._log("--- Detect ---")

            def on_done(msg: str, error: bool):
                self.after(0, lambda: self._done_callback(msg, error))

            _run_in_thread(
                run_detect,
                Path(zarr_s),
                pos,
                channel,
                Path(output_s),
                crop_slice=crop_slice,
                model=model,
                on_progress=self._progress_callback,
                on_done=on_done,
            )

        ctk.CTkButton(tab, text="Run Detect", command=run_detect_cmd).grid(row=row, column=0, columnspan=2, pady=20)

    def _build_plot_tab(self) -> None:
        tab = self.tabview.tab("Plot")
        tab.columnconfigure(1, weight=1)
        row = 0

        def add_row(label: str, widget):
            nonlocal row
            ctk.CTkLabel(tab, text=label, anchor="w").grid(row=row, column=0, sticky="w", padx=10, pady=6)
            widget.grid(row=row, column=1, sticky="ew", padx=10, pady=6)
            row += 1

        self.plot_input = ctk.CTkEntry(tab, placeholder_text="spots.csv")
        add_row("Input CSV:", self.plot_input)
        ctk.CTkButton(
            tab, text="Browse", width=80, command=lambda: _browse_file(tab, self.plot_input, filetypes=[("CSV", "*.csv")])
        ).grid(row=row - 1, column=2, padx=10, pady=6)

        self.plot_output = ctk.CTkEntry(tab, placeholder_text="spots.png")
        add_row("Output:", self.plot_output)
        ctk.CTkButton(
            tab,
            text="Browse",
            width=80,
            command=lambda: _browse_file_save(tab, self.plot_output, filetypes=[("PNG", "*.png")]),
        ).grid(row=row - 1, column=2, padx=10, pady=6)

        def run_plot_cmd():
            input_s = self.plot_input.get().strip()
            output_s = self.plot_output.get().strip()
            if not input_s or not output_s:
                self._log("Fill input and output paths.", error=True)
                return
            self.progress_bar.set(0)
            self.progress_label.configure(text="")
            self._log("--- Plot ---")

            def on_done(msg: str, error: bool):
                self.after(0, lambda: self._done_callback(msg, error))

            _run_in_thread(run_plot, Path(input_s), Path(output_s), on_done=on_done)

        ctk.CTkButton(tab, text="Run Plot", command=run_plot_cmd).grid(row=row, column=0, columnspan=2, pady=20)


def main() -> None:
    app = MuspotGUI()
    app.tabview.pack(fill="both", expand=True, padx=20, pady=20)
    app.mainloop()
