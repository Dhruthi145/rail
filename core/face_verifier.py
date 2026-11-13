import os
import cv2
import numpy as np
import time

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FACES_DIR = os.path.join(BASE_DIR, "database", "authorized_faces")

# Lazy-loaded FaceNet ResNet model & Haar face detector
_FACENET_MODEL = None
_HAAR_CASCADE = None
_EMBEDDING_CACHE = {}
_LAST_DIR_MTIME = 0

def _get_haar_cascade():
    global _HAAR_CASCADE
    if _HAAR_CASCADE is None:
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        if os.path.exists(cascade_path):
            _HAAR_CASCADE = cv2.CascadeClassifier(cascade_path)
    return _HAAR_CASCADE

def _get_facenet_model():
    global _FACENET_MODEL
    if _FACENET_MODEL is None:
        try:
            import torch
            from facenet_pytorch import InceptionResnetV1
            _FACENET_MODEL = InceptionResnetV1(pretrained='vggface2').eval()
        except Exception as e:
            print("[FaceVerifier Warning] Could not load InceptionResnetV1:", e)
            _FACENET_MODEL = False
    return _FACENET_MODEL

def extract_face_region(image):
    """
    Detects and crops the primary face from an image.
    If no frontal face is detected, returns the input image as fallback.
    """
    if image is None or image.size == 0:
        return None

    haar = _get_haar_cascade()
    if haar is not None and image.shape[0] >= 30 and image.shape[1] >= 30:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        faces = haar.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=3, minSize=(24, 24))
        if len(faces) > 0:
            # Pick the largest face detected
            largest_face = max(faces, key=lambda f: f[2] * f[3])
            fx, fy, fw, fh = largest_face
            # Add subtle margin around face
            pad_x = int(fw * 0.1)
            pad_y = int(fh * 0.1)
            y1 = max(0, fy - pad_y)
            y2 = min(image.shape[0], fy + fh + pad_y)
            x1 = max(0, fx - pad_x)
            x2 = min(image.shape[1], fx + fw + pad_x)
            face_crop = image[y1:y2, x1:x2]
            if face_crop.size > 0:
                return face_crop

    return image

def compute_face_embedding(face_img):
    """
    Computes a normalized 512-dimensional FaceNet feature vector.
    """
    if face_img is None or face_img.shape[0] < 12 or face_img.shape[1] < 12:
        return None

    model = _get_facenet_model()
    if not model:
        # Fallback to normalized RGB color histogram if torch/facenet model is unavailable
        resized = cv2.resize(face_img, (64, 64))
        hist = cv2.calcHist([resized], [0, 1, 2], None, [8, 8, 8], [0, 256, 0, 256, 0, 256])
        cv2.normalize(hist, hist)
        return hist.flatten()

    try:
        import torch
        img_rgb = cv2.cvtColor(face_img, cv2.COLOR_BGR2RGB)
        resized = cv2.resize(img_rgb, (160, 160))
        tensor = torch.tensor(resized, dtype=torch.float32).permute(2, 0, 1).unsqueeze(0)
        # FaceNet standard normalization: (x - 127.5) / 128.0
        tensor = (tensor - 127.5) / 128.0

        with torch.no_grad():
            emb = model(tensor).squeeze(0).cpu().numpy()

        norm = np.linalg.norm(emb)
        if norm > 0:
            emb = emb / norm
        return emb
    except Exception as e:
        print("[FaceVerifier Error] compute_face_embedding failed:", e)
        return None

def _get_ref_embeddings():
    """
    Loads and caches normalized embeddings for all registered authorized workers.
    Rebuilds cache automatically if authorized_faces directory is updated.
    """
    global _EMBEDDING_CACHE, _LAST_DIR_MTIME
    if not os.path.exists(FACES_DIR):
        return {}

    current_mtime = os.path.getmtime(FACES_DIR)
    if _EMBEDDING_CACHE and current_mtime == _LAST_DIR_MTIME:
        return _EMBEDDING_CACHE

    new_cache = {}
    registered_files = [f for f in os.listdir(FACES_DIR) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    for filename in registered_files:
        ref_path = os.path.join(FACES_DIR, filename)
        worker_id = os.path.splitext(filename)[0]
        ref_img = cv2.imread(ref_path)
        if ref_img is None:
            continue

        face_crop = extract_face_region(ref_img)
        emb = compute_face_embedding(face_crop)
        if emb is not None:
            new_cache[worker_id] = emb

    _EMBEDDING_CACHE = new_cache
    _LAST_DIR_MTIME = current_mtime
    return _EMBEDDING_CACHE

def verify_worker(face_crop):
    """
    Verifies a cropped face image against registered authorized workers using FaceNet deep embeddings.
    Returns: (is_authorized: bool, worker_id: str, confidence_desc: str)
    """
    if face_crop is None or face_crop.shape[0] < 16 or face_crop.shape[1] < 16:
        return False, "N/A", "Face Crop Too Small / Unclear"

    ref_embeddings = _get_ref_embeddings()
    if not ref_embeddings:
        return False, "N/A", "No Registered Workers Found"

    try:
        isolated_face = extract_face_region(face_crop)
        crop_emb = compute_face_embedding(isolated_face)
        if crop_emb is None:
            return False, "N/A", "Feature Extraction Failed"

        best_score = -1.0
        best_worker = None

        for worker_id, ref_emb in ref_embeddings.items():
            if len(crop_emb) == len(ref_emb):
                # Cosine similarity between unit-normalized vectors is dot product
                score = float(np.dot(crop_emb, ref_emb))
                if score > best_score:
                    best_score = score
                    best_worker = worker_id

        # Confidence thresholds for FaceNet L2-normalized cosine similarity
        if best_score >= 0.58 and best_worker:
            return True, best_worker, f"Verified ({best_worker}, {best_score:.0%})"
        elif best_score >= 0.42 and best_worker:
            return False, best_worker, f"Uncertain Match ({best_worker}, {best_score:.0%})"
    except Exception as e:
        print("[FaceVerifier Error] verify_worker error:", e)

    return False, "N/A", "UNAUTHORIZED INTRUDER"

def verify_image_file(image_path_or_bytes):
    """
    Convenience method to verify a standalone image file or byte stream against all registered workers.
    Returns: (is_authorized: bool, best_worker: str, score: float, details: dict)
    """
    if isinstance(image_path_or_bytes, (str, os.PathLike)):
        img = cv2.imread(str(image_path_or_bytes))
    else:
        nparr = np.frombuffer(image_path_or_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        return False, "N/A", 0.0, {"error": "Invalid image data"}

    face_crop = extract_face_region(img)
    emb = compute_face_embedding(face_crop)
    if emb is None:
        return False, "N/A", 0.0, {"error": "Could not extract face embedding"}

    ref_embeddings = _get_ref_embeddings()
    matches = []
    best_score = 0.0
    best_worker = "N/A"

    for worker_id, ref_emb in ref_embeddings.items():
        if len(emb) == len(ref_emb):
            score = float(np.dot(emb, ref_emb))
            matches.append({"worker_id": worker_id, "score": round(score, 3)})
            if score > best_score:
                best_score = score
                best_worker = worker_id

    matches.sort(key=lambda m: m["score"], reverse=True)
    is_auth = best_score >= 0.58
    status = "AUTHORIZED" if is_auth else ("UNCERTAIN" if best_score >= 0.42 else "UNAUTHORIZED")

    return is_auth, best_worker, best_score, {
        "status": status,
        "best_match": best_worker,
        "confidence": round(best_score * 100, 1),
        "all_matches": matches
    }