import cv2
import numpy as np
from shapely.geometry import Point, Polygon
from ultralytics import YOLO

from core.face_verifier import verify_worker
from core.costume_verifier import verify_costume
from core.risk_analyzer import RiskAnalyzer

class RailwayDetector:
    def __init__(self):
        self.model = YOLO("yolov8n.pt")
        self.risk_analyzer = RiskAnalyzer(pixels_per_meter=7.0, critical_ttc_threshold=4.0)

        # Configurable ROI Polygon (640x480 resolution frame mapping)
        # Configurable ROI Polygon (640x480 resolution frame mapping)
        # Point 1: Bottom-Left track boundary
        # Point 2: Top-Left horizon boundary
        # Point 3: Top-Right horizon boundary
        # Point 4: Bottom-Right track boundary
        self.default_roi_coords = [
            (100, 475),   # Point 1: Bottom-Left
            (180, 100),   # Point 2: Top-Left
            (460, 100),   # Point 3: Top-Right
            (580, 475)    # Point 4: Bottom-Right
        ]
        self.track_roi = Polygon(self.default_roi_coords)
        
        # Frame-persistence memory to prevent flickering when person is obscured
        self.intruder_memory_frames = 0
        self.last_telemetry = {}
        self.worker_verify_counter = 0
        self.last_worker_result = (False, "N/A", "NO_PERSON")

    def set_custom_roi(self, coords):
        """Allows dynamic ROI polygon updates from frontend UI configuration."""
        if len(coords) >= 3:
            self.default_roi_coords = coords
            self.track_roi = Polygon(coords)

    def process(self, frame):
        orig_h, orig_w = frame.shape[:2]
        frame = cv2.resize(frame, (640, 480))
        results = self.model(frame, verbose=False, conf=0.18)[0]

        any_person_in_roi = False
        unauthorized_in_roi = False
        active_person_box = None
        train_detected = False
        primary_train_box = None
        worker_id_label = "N/A"
        verification_status = "NO_PERSON"
        person_count = 0
        train_count = 0
        last_ppe_status = "N/A"

        for box in results.boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            xyxy = box.xyxy[0].cpu().numpy().astype(int)

            # Class 0: Person
            if cls_id == 0:
                person_count += 1
                feet_x = (xyxy[0] + xyxy[2]) // 2
                feet_y = xyxy[3]
                center_x = feet_x
                center_y = (xyxy[1] + xyxy[3]) // 2
                
                feet_pt = Point(feet_x, feet_y)
                center_pt = Point(center_x, center_y)
                
                # Check if person's feet OR center of body is inside restricted ROI
                in_roi = self.track_roi.contains(feet_pt) or self.track_roi.contains(center_pt)
                
                if in_roi:
                    any_person_in_roi = True
                    active_person_box = xyxy
                    
                    person_crop = frame[max(0, xyxy[1]):min(frame.shape[0], xyxy[3]),
                                        max(0, xyxy[0]):min(frame.shape[1], xyxy[2])]
                    
                    # Verify Orange Vest and Cap: If worn -> EMP001. Otherwise -> Intruder.
                    has_orange_vest_and_cap, ppe_status, ppe_details = verify_costume(person_crop)
                    last_ppe_status = ppe_status
                    
                    if has_orange_vest_and_cap:
                        worker_id_label = "EMP001"
                        verification_status = "AUTHORIZED"
                        self.intruder_memory_frames = 0
                        cv2.rectangle(frame, (xyxy[0], xyxy[1]), (xyxy[2], xyxy[3]), (0, 255, 0), 2)
                        cv2.putText(frame, "WORKER: EMP001 [ORANGE VEST + CAP]", (xyxy[0], max(16, xyxy[1] - 8)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.50, (0, 255, 0), 2)
                    else:
                        unauthorized_in_roi = True
                        self.intruder_memory_frames = 15  # 0.5s persistence buffer
                        worker_id_label = "N/A"
                        verification_status = "UNAUTHORIZED"
                        cv2.rectangle(frame, (xyxy[0], xyxy[1]), (xyxy[2], xyxy[3]), (0, 0, 255), 2)
                        cv2.putText(frame, "UNAUTHORIZED INTRUDER", (xyxy[0], max(16, xyxy[1] - 8)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.50, (0, 0, 255), 2)
                else:
                    # Person outside restricted track (Platform / Safe Walkway)
                    person_crop = frame[max(0, xyxy[1]):min(frame.shape[0], xyxy[3]),
                                        max(0, xyxy[0]):min(frame.shape[1], xyxy[2])]
                    has_orange_vest_and_cap, ppe_status, _ = verify_costume(person_crop)
                    if has_orange_vest_and_cap:
                        worker_id_label = "EMP001"
                        verification_status = "AUTHORIZED"
                        cv2.rectangle(frame, (xyxy[0], xyxy[1]), (xyxy[2], xyxy[3]), (0, 255, 0), 2)
                        cv2.putText(frame, "WORKER: EMP001 (Platform)", (xyxy[0], max(16, xyxy[1] - 8)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 0), 2)
                    else:
                        cv2.rectangle(frame, (xyxy[0], xyxy[1]), (xyxy[2], xyxy[3]), (180, 180, 180), 1)
                        cv2.putText(frame, "Platform Safe", (xyxy[0], xyxy[1] - 6),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (180, 180, 180), 1)

            # Class 6: Train / Class 7: Truck / Class 5: Bus / Class 2: Car on tracks
            elif cls_id in [2, 5, 6, 7]:
                train_count += 1
                train_detected = True
                primary_train_box = xyxy
                cv2.rectangle(frame, (xyxy[0], xyxy[1]), (xyxy[2], xyxy[3]), (255, 120, 0), 2)
                cv2.putText(frame, f"APPROACHING TRAIN ({conf:.2f})", (xyxy[0], xyxy[1] - 8),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 120, 0), 2)

        # Apply persistence buffer for smooth alert tracking
        if not unauthorized_in_roi and self.intruder_memory_frames > 0:
            unauthorized_in_roi = True
            self.intruder_memory_frames -= 1

        # Run Kinematic Risk Analysis
        telemetry = self.risk_analyzer.analyze(
            unauthorized_in_roi, train_detected, active_person_box, primary_train_box
        )
        telemetry["worker_id"] = worker_id_label
        telemetry["verification_status"] = verification_status
        telemetry["person_in_roi"] = any_person_in_roi
        telemetry["unauthorized_in_roi"] = unauthorized_in_roi
        telemetry["person_count"] = person_count
        telemetry["train_count"] = train_count
        telemetry["costume_status"] = last_ppe_status
        telemetry["roi_coords"] = self.default_roi_coords

        # HUD Color Palette & Risk Level Status Text
        raw_risk = telemetry["risk_level"]
        if "CRITICAL" in raw_risk:
            risk_color = (0, 0, 255)   # Red
            status_text = "CRITICAL: COLLISION RISK"
            alert_msg = "🚨 EMERGENCY WARNING DISPATCHED TO CONTROL ROOM & LOCO PILOT"
        elif "High" in raw_risk:
            risk_color = (0, 140, 255) # Orange
            status_text = "HIGH RISK: TRAIN APPROACHING"
            alert_msg = "⚠️ HIGH ALERT: TRAIN IN VICINITY OF TRACK OCCUPANT"
        elif "Medium" in raw_risk or "WARNING" in raw_risk:
            risk_color = (0, 255, 255) # Yellow
            status_text = "WARNING: TRACK OCCUPIED"
            alert_msg = "⚠️ MONITORING: UNAUTHORIZED PERSON ON RESTRICTED TRACK"
        else:
            risk_color = (0, 255, 0)   # Green
            status_text = "TRACK SAFE"
            alert_msg = "✓ NORMAL SURVEILLANCE OPERATIONS"

        telemetry["hud_status_text"] = status_text
        telemetry["alert_message"] = alert_msg

        # Draw Track ROI Polygon onto video frame (visible on Dashboard & Live Monitoring)
        roi_pts = np.array(self.default_roi_coords, np.int32).reshape((-1, 1, 2))

        # Subtle semi-transparent fill
        overlay = frame.copy()
        fill_color = (0, 0, 160) if unauthorized_in_roi else (160, 100, 20)
        cv2.fillPoly(overlay, [roi_pts], fill_color)
        cv2.addWeighted(overlay, 0.18, frame, 0.82, 0, frame)

        # Crisp perimeter border
        border_color = (0, 0, 255) if unauthorized_in_roi else (255, 165, 0)
        cv2.polylines(frame, [roi_pts], isClosed=True, color=border_color, thickness=2, lineType=cv2.LINE_AA)

        # Corner anchor points
        for pt in self.default_roi_coords:
            cv2.circle(frame, (int(pt[0]), int(pt[1])), 4, (255, 255, 255), -1, lineType=cv2.LINE_AA)
            cv2.circle(frame, (int(pt[0]), int(pt[1])), 5, border_color, 1, lineType=cv2.LINE_AA)

        # ROI Header Label Tag
        p_top = self.default_roi_coords[1]
        roi_tag = "TRACK ROI: INTRUSION ACTIVE" if unauthorized_in_roi else "TRACK ROI: MONITORED ZONE"
        cv2.putText(frame, roi_tag, (p_top[0] - 10, max(24, p_top[1] - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, border_color, 1, lineType=cv2.LINE_AA)

        # Top Diagnostic Telemetry HUD Panel
        cv2.rectangle(frame, (10, 10), (520, 80), (15, 15, 15), -1)
        cv2.rectangle(frame, (10, 10), (520, 80), risk_color, 1)
        cv2.putText(frame, f"SYSTEM STATUS: {status_text}", (20, 36),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, risk_color, 2)
        
        info_text = f"TTC: {telemetry['ttc']}s | Distance: {telemetry['distance']}m | Speed: {telemetry['train_speed']} km/h"
        cv2.putText(frame, info_text, (20, 62), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)

        self.last_telemetry = telemetry
        return frame, telemetry