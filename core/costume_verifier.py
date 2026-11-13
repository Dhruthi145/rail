# RailGuard AI - Railway Personnel Costume Verification Module
# Verifies genuine fluorescent high-visibility safety gear:
# 1. Bright Canary Yellow Safety Hard Hat / Helmet (Head region)
# 2. Fluorescent High-Visibility Safety Orange Vest (Torso region)

import cv2
import numpy as np

def verify_costume(person_crop):
    """Verify person crop for genuine orange vest and yellow cap."""
    if person_crop is None or person_crop.size == 0:
        return False, "NO_PERSON_CROP", {"has_cap": False, "has_vest": False}

    h, w = person_crop.shape[:2]
    if h < 20 or w < 10:
        return False, "CROP_TOO_SMALL", {"has_cap": False, "has_vest": False}

    # Head zone: top 24% of bounding box
    head_h = max(5, int(h * 0.24))
    head_crop = person_crop[:head_h, :]

    # Torso zone: 14% to 62% of bounding box
    torso_y1 = int(h * 0.14)
    torso_y2 = int(h * 0.62)
    torso_crop = person_crop[torso_y1:torso_y2, :]

    hsv_head = cv2.cvtColor(head_crop, cv2.COLOR_BGR2HSV)
    hsv_torso = cv2.cvtColor(torso_crop, cv2.COLOR_BGR2HSV)

    # 1. Genuine Yellow Safety Helmet / Cap:
    # Requires high saturation (S >= 90) and brightness (V >= 90) to reject plain hair / dust / concrete / skin
    yellow_mask = cv2.inRange(hsv_head, np.array([15, 90, 90]), np.array([38, 255, 255]))
    cap_ratio = np.count_nonzero(yellow_mask) / yellow_mask.size
    has_cap = cap_ratio >= 0.035

    # 2. Genuine Fluorescent High-Vis Orange Vest:
    # Requires high saturation (S >= 90) and brightness (V >= 90) to reject plain beige/tan/brown/grey shirts
    orange_mask = cv2.inRange(hsv_torso, np.array([4, 90, 90]), np.array([23, 255, 255]))
    vest_ratio = np.count_nonzero(orange_mask) / orange_mask.size
    has_vest = vest_ratio >= 0.07

    # Strictly require BOTH high-vis orange vest AND yellow safety cap
    is_emp001 = bool(has_cap and has_vest)

    if is_emp001:
        status = "Orange Vest + Cap (EMP001)"
    elif has_vest and not has_cap:
        status = "Orange Vest Only (Missing Cap)"
    elif has_cap and not has_vest:
        status = "Cap Only (Missing Orange Vest)"
    else:
        status = "No Vest / No Cap (Intruder)"

    return is_emp001, status, {
        "has_cap": bool(has_cap),
        "has_vest": bool(has_vest),
        "cap_ratio": float(round(cap_ratio, 4)),
        "vest_ratio": float(round(vest_ratio, 4)),
        "status": status
    }
