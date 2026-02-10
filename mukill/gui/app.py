"""mukill GUI – CustomTkinter application."""

from __future__ import annotations

import threading
import tkinter.filedialog as fd
from pathlib import Path

import customtkinter as ctk

from core import run_clean, run_dataset, run_plot, run_predict, run_train

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


class MukillGUI(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("mukill")
        self.geometry("640x650")
        self.minsize(500, 500)

        self.log_text = ctk.CTkTextbox(self, height=100, state="disabled")
        self.progress_bar = ctk.CTkProgressBar(self)
        self.progress_bar.set(0)
        self.progress_label = ctk.CTkLabel(self, text="")

        top = ctk.CTkFrame(self, fg_color="transparent")
        top.pack(fill="x", padx=20, pady=(20, 0))
        ctk.CTkLabel(top, text="mukill", font=ctk.CTkFont(size=20)).pack(side="left")
        self.theme_btn = ctk.CTkButton(top, text="Light", width=60, command=self._toggle_theme)
        self.theme_btn.pack(side="right")

        self.tabview = ctk.CTkTabview(self)
        for name in ["Dataset", "Train", "Predict", "Plot", "Clean"]:
            self.tabview.add(name)

        self._build_dataset_tab()
        self._build_train_tab()
        self._build_predict_tab()
        self._build_plot_tab()
        self._build_clean_tab()

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

    def _add_row(self, tab, row_ref, label: str, widget):
        r = row_ref[0]
        ctk.CTkLabel(tab, text=label, anchor="w").grid(row=r, column=0, sticky="w", padx=10, pady=6)
        widget.grid(row=r, column=1, sticky="ew", padx=10, pady=6)
        row_ref[0] += 1

    def _build_dataset_tab(self) -> None:
        tab = self.tabview.tab("Dataset")
        tab.columnconfigure(1, weight=1)
        row = [0]

        self.ds_zarr = ctk.CTkEntry(tab, placeholder_text="Path to crops.zarr")
        self._add_row(tab, row, "Zarr path:", self.ds_zarr)
        ctk.CTkButton(tab, text="Browse", width=80, command=lambda: _browse_dir(tab, self.ds_zarr)).grid(
            row=row[0] - 1, column=2, padx=10, pady=6
        )

        self.ds_pos = ctk.CTkEntry(tab, placeholder_text="Position")
        self._add_row(tab, row, "Position:", self.ds_pos)

        self.ds_annotations = ctk.CTkEntry(tab, placeholder_text="annotations.csv")
        self._add_row(tab, row, "Annotations:", self.ds_annotations)
        ctk.CTkButton(
            tab, text="Browse", width=80, command=lambda: _browse_file(tab, self.ds_annotations, filetypes=[("CSV", "*.csv")])
        ).grid(row=row[0] - 1, column=2, padx=10, pady=6)

        self.ds_output = ctk.CTkEntry(tab, placeholder_text="Output dir")
        self._add_row(tab, row, "Output:", self.ds_output)
        ctk.CTkButton(tab, text="Browse", width=80, command=lambda: _browse_dir(tab, self.ds_output)).grid(
            row=row[0] - 1, column=2, padx=10, pady=6
        )

        def run():
            for k, v in [
                ("zarr", self.ds_zarr.get().strip()),
                ("pos", self.ds_pos.get().strip()),
                ("annotations", self.ds_annotations.get().strip()),
                ("output", self.ds_output.get().strip()),
            ]:
                if not v:
                    self._log(f"Fill {k}.", error=True)
                    return
            try:
                pos = int(self.ds_pos.get().strip())
            except ValueError:
                self._log("Position must be integer.", error=True)
                return
            self.progress_bar.set(0)
            self.progress_label.configure(text="")
            self._log("--- Dataset ---")

            def on_done(msg, err):
                self.after(0, lambda: self._done_callback(msg, err))

            _run_in_thread(
                run_dataset,
                Path(self.ds_zarr.get().strip()),
                pos,
                Path(self.ds_annotations.get().strip()),
                Path(self.ds_output.get().strip()),
                on_progress=self._progress_callback,
                on_done=on_done,
            )

        ctk.CTkButton(tab, text="Run Dataset", command=run).grid(row=row[0], column=0, columnspan=2, pady=20)

    def _build_train_tab(self) -> None:
        tab = self.tabview.tab("Train")
        tab.columnconfigure(1, weight=1)
        row = [0]

        self.train_dataset = ctk.CTkEntry(tab, placeholder_text="Path to dataset")
        self._add_row(tab, row, "Dataset:", self.train_dataset)
        ctk.CTkButton(tab, text="Browse", width=80, command=lambda: _browse_dir(tab, self.train_dataset)).grid(
            row=row[0] - 1, column=2, padx=10, pady=6
        )

        self.train_output = ctk.CTkEntry(tab, placeholder_text="Output model dir")
        self._add_row(tab, row, "Output:", self.train_output)
        ctk.CTkButton(tab, text="Browse", width=80, command=lambda: _browse_dir(tab, self.train_output)).grid(
            row=row[0] - 1, column=2, padx=10, pady=6
        )

        self.train_epochs = ctk.CTkEntry(tab, placeholder_text="20")
        self._add_row(tab, row, "Epochs:", self.train_epochs)

        self.train_batch = ctk.CTkEntry(tab, placeholder_text="32")
        self._add_row(tab, row, "Batch size:", self.train_batch)

        self.train_lr = ctk.CTkEntry(tab, placeholder_text="1e-4")
        self._add_row(tab, row, "Learning rate:", self.train_lr)

        self.train_split = ctk.CTkEntry(tab, placeholder_text="0.2")
        self._add_row(tab, row, "Val split:", self.train_split)

        def run():
            ds = self.train_dataset.get().strip()
            out = self.train_output.get().strip()
            if not ds or not out:
                self._log("Fill dataset and output.", error=True)
                return
            try:
                epochs = int(self.train_epochs.get().strip() or "20")
                batch = int(self.train_batch.get().strip() or "32")
                lr = float(self.train_lr.get().strip() or "1e-4")
                split = float(self.train_split.get().strip() or "0.2")
            except ValueError:
                self._log("Invalid numeric field.", error=True)
                return
            self.progress_bar.set(0)
            self.progress_label.configure(text="")
            self._log("--- Train ---")

            def on_done(msg, err):
                self.after(0, lambda: self._done_callback(msg, err))

            _run_in_thread(
                run_train,
                Path(ds),
                Path(out),
                epochs,
                batch,
                lr,
                split,
                on_progress=self._progress_callback,
                on_done=on_done,
            )

        ctk.CTkButton(tab, text="Run Train", command=run).grid(row=row[0], column=0, columnspan=2, pady=20)

    def _build_predict_tab(self) -> None:
        tab = self.tabview.tab("Predict")
        tab.columnconfigure(1, weight=1)
        row = [0]

        self.pred_zarr = ctk.CTkEntry(tab, placeholder_text="Path to crops.zarr")
        self._add_row(tab, row, "Zarr path:", self.pred_zarr)
        ctk.CTkButton(tab, text="Browse", width=80, command=lambda: _browse_dir(tab, self.pred_zarr)).grid(
            row=row[0] - 1, column=2, padx=10, pady=6
        )

        self.pred_pos = ctk.CTkEntry(tab, placeholder_text="Position")
        self._add_row(tab, row, "Position:", self.pred_pos)

        self.pred_model = ctk.CTkEntry(tab, placeholder_text="Model path or HF ID")
        self._add_row(tab, row, "Model:", self.pred_model)
        ctk.CTkButton(tab, text="Browse", width=80, command=lambda: _browse_dir(tab, self.pred_model)).grid(
            row=row[0] - 1, column=2, padx=10, pady=6
        )

        self.pred_output = ctk.CTkEntry(tab, placeholder_text="predictions.csv")
        self._add_row(tab, row, "Output:", self.pred_output)
        ctk.CTkButton(
            tab,
            text="Browse",
            width=80,
            command=lambda: _browse_file_save(tab, self.pred_output, filetypes=[("CSV", "*.csv")]),
        ).grid(row=row[0] - 1, column=2, padx=10, pady=6)

        self.pred_batch = ctk.CTkEntry(tab, placeholder_text="64")
        self._add_row(tab, row, "Batch size:", self.pred_batch)

        def run():
            for k, v in [
                ("zarr", self.pred_zarr.get().strip()),
                ("pos", self.pred_pos.get().strip()),
                ("model", self.pred_model.get().strip()),
                ("output", self.pred_output.get().strip()),
            ]:
                if not v:
                    self._log(f"Fill {k}.", error=True)
                    return
            try:
                pos = int(self.pred_pos.get().strip())
                batch = int(self.pred_batch.get().strip() or "64")
            except ValueError:
                self._log("Position and batch size must be integers.", error=True)
                return
            self.progress_bar.set(0)
            self.progress_label.configure(text="")
            self._log("--- Predict ---")

            def on_done(msg, err):
                self.after(0, lambda: self._done_callback(msg, err))

            _run_in_thread(
                run_predict,
                Path(self.pred_zarr.get().strip()),
                pos,
                self.pred_model.get().strip(),
                Path(self.pred_output.get().strip()),
                batch_size=batch,
                on_progress=self._progress_callback,
                on_done=on_done,
            )

        ctk.CTkButton(tab, text="Run Predict", command=run).grid(row=row[0], column=0, columnspan=2, pady=20)

    def _build_plot_tab(self) -> None:
        tab = self.tabview.tab("Plot")
        tab.columnconfigure(1, weight=1)
        row = [0]

        self.plot_input = ctk.CTkEntry(tab, placeholder_text="predictions.csv")
        self._add_row(tab, row, "Input CSV:", self.plot_input)
        ctk.CTkButton(
            tab, text="Browse", width=80, command=lambda: _browse_file(tab, self.plot_input, filetypes=[("CSV", "*.csv")])
        ).grid(row=row[0] - 1, column=2, padx=10, pady=6)

        self.plot_output = ctk.CTkEntry(tab, placeholder_text="plot.png")
        self._add_row(tab, row, "Output:", self.plot_output)
        ctk.CTkButton(
            tab,
            text="Browse",
            width=80,
            command=lambda: _browse_file_save(tab, self.plot_output, filetypes=[("PNG", "*.png")]),
        ).grid(row=row[0] - 1, column=2, padx=10, pady=6)

        def run():
            inp = self.plot_input.get().strip()
            out = self.plot_output.get().strip()
            if not inp or not out:
                self._log("Fill input and output.", error=True)
                return
            self.progress_bar.set(0)
            self.progress_label.configure(text="")
            self._log("--- Plot ---")

            def on_done(msg, err):
                self.after(0, lambda: self._done_callback(msg, err))

            _run_in_thread(run_plot, Path(inp), Path(out), on_done=on_done)

        ctk.CTkButton(tab, text="Run Plot", command=run).grid(row=row[0], column=0, columnspan=2, pady=20)

    def _build_clean_tab(self) -> None:
        tab = self.tabview.tab("Clean")
        tab.columnconfigure(1, weight=1)
        row = [0]

        self.clean_input = ctk.CTkEntry(tab, placeholder_text="predictions.csv")
        self._add_row(tab, row, "Input CSV:", self.clean_input)
        ctk.CTkButton(
            tab, text="Browse", width=80, command=lambda: _browse_file(tab, self.clean_input, filetypes=[("CSV", "*.csv")])
        ).grid(row=row[0] - 1, column=2, padx=10, pady=6)

        self.clean_output = ctk.CTkEntry(tab, placeholder_text="cleaned.csv")
        self._add_row(tab, row, "Output:", self.clean_output)
        ctk.CTkButton(
            tab,
            text="Browse",
            width=80,
            command=lambda: _browse_file_save(tab, self.clean_output, filetypes=[("CSV", "*.csv")]),
        ).grid(row=row[0] - 1, column=2, padx=10, pady=6)

        def run():
            inp = self.clean_input.get().strip()
            out = self.clean_output.get().strip()
            if not inp or not out:
                self._log("Fill input and output.", error=True)
                return
            self.progress_bar.set(0)
            self.progress_label.configure(text="")
            self._log("--- Clean ---")

            def on_done(msg, err):
                self.after(0, lambda: self._done_callback(msg, err))

            _run_in_thread(run_clean, Path(inp), Path(out), on_done=on_done)

        ctk.CTkButton(tab, text="Run Clean", command=run).grid(row=row[0], column=0, columnspan=2, pady=20)


def main() -> None:
    app = MukillGUI()
    app.tabview.pack(fill="both", expand=True, padx=20, pady=20)
    app.mainloop()
