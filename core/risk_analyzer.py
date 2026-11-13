import time

class RiskAnalyzer:
    def __init__(self, pixels_per_meter=8.0, critical_ttc_threshold=4.0):
        self.ppm = pixels_per_meter
        self.critical_ttc = critical_ttc_threshold
        self.occupancy_start_time = None
        self.last_train_y = None
        self.last_train_time = None
        
    def reset_occupancy(self):
        self.occupancy_start_time = None

    def analyze(self, unauthorized_person_detected, train_detected, person_box, train_box):
        """
        Calculates occupancy duration, train velocity, distance, TTC, and Risk Level.
        Returns a dictionary containing all computed kinematic parameters.
        """
        now = time.time()
        
        # 1. Track Occupancy
        occupancy_sec = 0.0
        if unauthorized_person_detected:
            if self.occupancy_start_time is None:
                self.occupancy_start_time = now
            occupancy_sec = now - self.occupancy_start_time
        else:
            self.reset_occupancy()
            
        # Defaults
        distance_m = 0.0
        train_speed_kmh = 0.0
        ttc = float('inf')
        risk_level = "🟢 Safe"
        alert_status = "NORMAL"

        # Calculate Train Speed & Position if train is detected
        if train_detected and train_box is not None:
            tx, ty = (train_box[0] + train_box[2]) / 2, train_box[3]
            
            if self.last_train_y is not None and self.last_train_time is not None:
                dt = max(0.01, now - self.last_train_time)
                dy_meters = abs(ty - self.last_train_y) / self.ppm
                inst_speed_mps = dy_meters / dt
                train_speed_kmh = min(120.0, inst_speed_mps * 3.6)
                if train_speed_kmh < 15.0:
                    train_speed_kmh = 42.5  # Typical train approach speed baseline
            else:
                train_speed_kmh = 45.0  # Baseline train speed

            self.last_train_y = ty
            self.last_train_time = now
        else:
            self.last_train_y = None
            self.last_train_time = None

        # Scenario A: Track Clear (No Intruder)
        if not unauthorized_person_detected:
            if train_detected:
                return {
                    "risk_level": "🟡 Caution (Train Approaching)",
                    "alert_status": "TRAIN_APPROACHING",
                    "ttc": float('inf'),
                    "distance": round(max(5.0, (480 - (train_box[3] if train_box is not None else 240)) / self.ppm), 1),
                    "train_speed": round(train_speed_kmh, 1),
                    "occupancy_sec": 0.0,
                    "train_present": True
                }
            else:
                return {
                    "risk_level": "🟢 Safe",
                    "alert_status": "NORMAL",
                    "ttc": float('inf'),
                    "distance": 0.0,
                    "train_speed": 0.0,
                    "occupancy_sec": 0.0,
                    "train_present": False
                }

        # Scenario B: Person in ROI, but No Train
        if unauthorized_person_detected and not train_detected:
            return {
                "risk_level": "🟡 Medium (Track Occupied)",
                "alert_status": "INTRUSION_WARNING",
                "ttc": float('inf'),
                "distance": 0.0,
                "train_speed": 0.0,
                "occupancy_sec": round(occupancy_sec, 1),
                "train_present": False
            }

        # Scenario C: Both Unauthorized Person and Train Detected
        if person_box is None or train_box is None:
            return {
                "risk_level": "🟠 High (Approaching Train)" if train_detected else "🟡 Medium (Track Occupied)",
                "alert_status": "HIGH_ALERT" if train_detected else "INTRUSION_WARNING",
                "ttc": 6.0 if train_detected else float('inf'),
                "distance": 15.0 if train_detected else 0.0,
                "train_speed": round(train_speed_kmh, 1),
                "occupancy_sec": round(occupancy_sec, 1),
                "train_present": train_detected
            }

        px, py = (person_box[0] + person_box[2]) / 2, person_box[3]
        tx, ty = (train_box[0] + train_box[2]) / 2, train_box[3]

        pixel_dist = abs(py - ty)
        distance_m = max(1.5, pixel_dist / self.ppm)

        speed_mps = max(2.0, train_speed_kmh / 3.6)
        ttc = distance_m / speed_mps

        # Risk Tier Classification
        if ttc <= self.critical_ttc or distance_m <= 12.0:
            risk_level = "🔴 CRITICAL: COLLISION RISK"
            alert_status = "EMERGENCY_DISPATCH"
        elif ttc <= 10.0 or distance_m <= 25.0:
            risk_level = "🟠 High (Approaching Train)"
            alert_status = "HIGH_ALERT"
        else:
            risk_level = "🟡 Medium (Train in Vicinity)"
            alert_status = "WARNING"

        return {
            "risk_level": risk_level,
            "alert_status": alert_status,
            "ttc": round(ttc, 2),
            "distance": round(distance_m, 1),
            "train_speed": round(train_speed_kmh, 1),
            "occupancy_sec": round(occupancy_sec, 1),
            "train_present": True
        }