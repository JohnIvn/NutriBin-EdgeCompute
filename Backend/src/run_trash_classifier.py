import sys
import os
import base64
from io import BytesIO
from PIL import Image
from transformers import AutoImageProcessor, ViTForImageClassification
import torch

MODEL_DIR = os.path.join(os.path.dirname(__file__), 'trash-clasiffier-biodegradable')

image_processor = AutoImageProcessor.from_pretrained(MODEL_DIR)
model = ViTForImageClassification.from_pretrained(MODEL_DIR)

def predict_from_base64(b64_string):
    image = Image.open(BytesIO(base64.b64decode(b64_string)))
    inputs = image_processor(images=image, return_tensors="pt")
    with torch.no_grad():
        outputs = model(**inputs)
        logits = outputs.logits
        probs = torch.nn.functional.softmax(logits, dim=-1)
        predicted_class_idx = logits.argmax(-1).item()
        label = model.config.id2label[str(predicted_class_idx)]
        confidence = probs[0, predicted_class_idx].item()
    return label, confidence

if __name__ == "__main__":
    b64 = sys.argv[1]
    label, confidence = predict_from_base64(b64)
    print(f"{label},{confidence:.4f}")
