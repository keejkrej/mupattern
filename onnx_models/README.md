# ONNX models for mupattern-desktop

Pre-exported ONNX models for running inference in mupattern-desktop without Python.

## mupattern-resnet18

Binary classifier (absent/present) for kill curve analysis. Converted from [keejkrej/mupattern-resnet18](https://huggingface.co/keejkrej/mupattern-resnet18).

**To re-export** (e.g. after fine-tuning):

```bash
uv run optimum-cli export onnx --model keejkrej/mupattern-resnet18 onnx_models/mupattern-resnet18
```

Or with a local trained model:

```bash
uv run optimum-cli export onnx --model ./path/to/trained-model onnx_models/my-model
```

**Preprocessing** (for inference in TypeScript): resize to 224×224, rescale 1/255, normalize with ImageNet mean/std: `[0.485, 0.456, 0.406]` and `[0.229, 0.224, 0.225]`.
