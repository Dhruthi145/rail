import os
import cv2
import time
import numpy as np
from functools import wraps
from flask import Flask, render_template, Response, request, redirect, url_for, jsonify, send_from_directory, session, flash
from core.detector import RailwayDetector
from core.face_verifier import verify_image_file
from database.db_manager import (
    init_db, log_incident, get_all_logs, verify_hash_chain,
    get_all_workers, add_worker, delete_worker, get_analytics_summary,
    authenticate_operator, get_operator
)

app = Flask(__name__)
app.secret_key = os.environ.get('RAIL_SECRET_KEY', 'railway_safety_super_secret_session_key_2026')
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.jinja_env.auto_reload = True

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return redirect(url_for('login_page', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

@app.context_processor
def inject_user():
    return {
        'current_user': session.get('user'),
        'user_role': session.get('role', 'guest'),
        'is_authenticated': 'user' in session
    }

# System Directory Configurations
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
FACES_FOLDER = os.path.join(BASE_DIR, 'database', 'authorized_faces')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(FACES_FOLDER, exist_ok=True)

# Static file route for authorized worker face images
@app.route('/database/authorized_faces/<path:filename>')
def serve_face_image(filename):
    return send_from_directory(FACES_FOLDER, filename)

# No default sample video - System remains in standby until user uploads a video
CURRENT_VIDEO_SOURCE = None
detector = RailwayDetector()

# Throttling Configuration states to prevent overflowing database logs
LAST_LOGGED_STATE = "SAFE"
LAST_LOG_TIME = 0.0

STANDBY_TELEMETRY = {
    "risk_level": "⚪ Standby",
    "alert_status": "STANDBY",
    "ttc": "N/A",
    "distance": 0.0,
    "train_speed": 0.0,
    "worker_id": "N/A",
    "verification_status": "STANDBY",
    "person_in_roi": False,
    "person_count": 0,
    "train_count": 0,
    "hud_status_text": "STANDBY - AWAITING VIDEO",
    "alert_message": "⏸ System Standby: Please upload a CCTV video file to begin AI surveillance & analytics."
}
CURRENT_TELEMETRY = dict(STANDBY_TELEMETRY)

def make_standby_frame(counter=0):
    """Generates a professional dark HUD standby frame indicating system is awaiting video upload."""
    frame = np.full((480, 640, 3), (20, 15, 12), dtype=np.uint8)  # Deep dark slate/navy

    # Tech grid lines
    for y in range(0, 480, 40):
        cv2.line(frame, (0, y), (640, y), (30, 24, 20), 1)
    for x in range(0, 640, 40):
        cv2.line(frame, (x, 0), (x, 480), (30, 24, 20), 1)

    # Accent corner brackets
    c_len = 25
    color_cyan = (248, 189, 56)  # Light cyan/blue in BGR
    # Corners
    cv2.line(frame, (35, 35), (35 + c_len, 35), color_cyan, 2)
    cv2.line(frame, (35, 35), (35, 35 + c_len), color_cyan, 2)
    cv2.line(frame, (605, 35), (605 - c_len, 35), color_cyan, 2)
    cv2.line(frame, (605, 35), (605, 35 + c_len), color_cyan, 2)
    cv2.line(frame, (35, 445), (35 + c_len, 445), color_cyan, 2)
    cv2.line(frame, (35, 445), (35, 445 - c_len), color_cyan, 2)
    cv2.line(frame, (605, 445), (605 - c_len, 445), color_cyan, 2)
    cv2.line(frame, (605, 445), (605, 445 - c_len), color_cyan, 2)

    # Central dialogue card
    cv2.rectangle(frame, (90, 140), (550, 340), (36, 28, 22), -1)
    cv2.rectangle(frame, (90, 140), (550, 340), (75, 60, 48), 1)

    # Pulsing status indicator dot
    dot_color = (0, 220, 255) if (counter % 2 == 0) else (0, 130, 170)
    cv2.circle(frame, (125, 185), 8, dot_color, -1)
    cv2.putText(frame, "NO ACTIVE VIDEO FEED", (145, 192), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 255, 255), 2)

    cv2.putText(frame, "AI Surveillance Engine: STANDBY", (125, 235), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1)
    cv2.putText(frame, "Please upload a track video file (.mp4, .mov, .avi)", (125, 265), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (120, 210, 255), 1)
    cv2.putText(frame, "Analytics and detection will start automatically upon upload.", (125, 290), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (160, 160, 160), 1)

    # Bottom status bar
    cv2.rectangle(frame, (90, 310), (550, 340), (25, 18, 14), -1)
    cv2.putText(frame, "STATUS: AWAITING USER VIDEO UPLOAD...", (125, 330), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 235, 255), 1)

    return frame

def generate_video_stream():
    global CURRENT_VIDEO_SOURCE, LAST_LOGGED_STATE, LAST_LOG_TIME, CURRENT_TELEMETRY, detector
    last_source = None
    camera = None
    last_good_frame = None
    standby_counter = 0

    while True:
        # Check if video source is not configured or does not exist
        if not CURRENT_VIDEO_SOURCE or not os.path.exists(CURRENT_VIDEO_SOURCE):
            if camera is not None:
                try:
                    camera.release()
                except Exception:
                    pass
                camera = None
                last_source = None
                last_good_frame = None

            # Keep telemetry in standby state while no video is uploaded
            CURRENT_TELEMETRY = dict(STANDBY_TELEMETRY)

            standby_frame = make_standby_frame(standby_counter)
            standby_counter += 1
            ret, buffer = cv2.imencode('.jpg', standby_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if ret:
                yield (b'--frame\r\n' b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
            time.sleep(0.5)
            continue

        # Dynamically switch video contexts if a new video source path is declared
        if CURRENT_VIDEO_SOURCE != last_source or camera is None:
            if camera is not None:
                try:
                    camera.release()
                except Exception:
                    pass
            camera = cv2.VideoCapture(CURRENT_VIDEO_SOURCE)
            last_source = CURRENT_VIDEO_SOURCE
            last_good_frame = None

        loop_start = time.time()
        success, frame = camera.read()
        if not success or frame is None:
            # Reached End-Of-File (EOF): Rewind to beginning (frame 0) for continuous video analysis
            if camera is not None:
                camera.set(cv2.CAP_PROP_POS_FRAMES, 0)
                success, frame = camera.read()

            # If set(POS_FRAMES) is unsupported by codec/container, re-instantiate VideoCapture
            if not success or frame is None:
                if camera is not None:
                    try:
                        camera.release()
                    except Exception:
                        pass
                camera = cv2.VideoCapture(CURRENT_VIDEO_SOURCE)
                success, frame = camera.read()

        if success and frame is not None:
            last_good_frame = frame.copy()
        elif last_good_frame is not None:
            frame = last_good_frame.copy()
        else:
            time.sleep(0.03)
            continue

        # Pipeline Stage 1, 2, & 3: Run Detection, Face Verification, and Kinematic Calculations
        processed_frame, telemetry = detector.process(frame)
        CURRENT_TELEMETRY = telemetry

        # Stage 5 (RECORD): Handle Throttled SQLite Logging State Transitions
        current_time = time.time()
        current_risk = telemetry["risk_level"]
        
        # Log incidents if the risk level changes into a warning/critical state, or every 8s if danger persists
        should_log = (current_risk != LAST_LOGGED_STATE and "Safe" not in current_risk) or \
                     ("Safe" not in current_risk and (current_time - LAST_LOG_TIME > 8.0))

        if should_log:
            log_incident(
                camera_id="CAM_TRACK_01",
                location="Main Track Zone 01",
                person_status=telemetry["verification_status"],
                worker_id=telemetry["worker_id"],
                train_status="Approaching" if telemetry.get("train_present", False) else "None Detected",
                train_speed=telemetry["train_speed"],
                distance=telemetry["distance"],
                ttc=telemetry["ttc"] if telemetry["ttc"] != float('inf') else 999.0,
                risk_level=current_risk,
                alert_status=telemetry["alert_status"]
            )
            LAST_LOGGED_STATE = current_risk
            LAST_LOG_TIME = current_time
        elif "Safe" in current_risk:
            LAST_LOGGED_STATE = "SAFE"

        # Compress output array matrix back to sequential JPEG stream
        ret, buffer = cv2.imencode('.jpg', processed_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        if ret:
            yield (b'--frame\r\n' b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')

        # Adaptive real-time frame pacing (smooth 30 FPS target)
        elapsed = time.time() - loop_start
        target_delay = 0.033 - elapsed
        if target_delay > 0:
            time.sleep(target_delay)

# ----------------- Web UI Page Routes -----------------

@app.route('/')
def dashboard():
    return render_template('index.html')

@app.route('/monitoring')
@login_required
def monitoring():
    return render_template('monitoring.html')

@app.route('/incidents')
@app.route('/logs_page')
@login_required
def incidents_page():
    return render_template('incidents.html')

@app.route('/workers')
@login_required
def workers_page():
    return render_template('workers.html')

@app.route('/analytics')
@login_required
def analytics_page():
    return render_template('analytics.html')

@app.route('/settings')
@login_required
def settings_page():
    return render_template('settings.html')

@app.route('/login', methods=['GET', 'POST'])
def login_page():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()
        
        is_auth, user_data = authenticate_operator(username, password)
        if is_auth and user_data:
            session['user'] = user_data['username']
            session['role'] = user_data['role']
            flash(f"Welcome back, {user_data['username']}! Control Room access authorized.", "success")
            next_url = request.args.get('next') or request.form.get('next') or url_for('monitoring')
            return redirect(next_url)
        else:
            flash("Invalid operator credentials. Please check Badge ID and password.", "danger")
            return render_template('login.html', username=username)

    if 'user' in session:
        return redirect(url_for('monitoring'))

    return render_template('login.html')

@app.route('/logout')
def logout():
    user = session.get('user', 'Operator')
    session.clear()
    flash(f"Operator {user} logged out successfully. Control room locked.", "info")
    return redirect(url_for('login_page'))

@app.route('/video_feed')
def video_feed():
    return Response(generate_video_stream(), mimetype='multipart/x-mixed-replace; boundary=frame')

# ----------------- RESTful API Endpoints -----------------

@app.route('/api/telemetry')
def api_telemetry():
    """Returns real-time telemetry dictionary for live JS dashboard polling."""
    sanitized = dict(CURRENT_TELEMETRY)
    if sanitized.get("ttc") == float('inf'):
        sanitized["ttc"] = "N/A"
    sanitized["has_video"] = bool(CURRENT_VIDEO_SOURCE and os.path.exists(CURRENT_VIDEO_SOURCE))
    sanitized["video_filename"] = os.path.basename(CURRENT_VIDEO_SOURCE) if CURRENT_VIDEO_SOURCE else None
    sanitized["roi_coords"] = detector.default_roi_coords
    return jsonify(sanitized)

@app.route('/api/set_roi', methods=['POST'])
def api_set_roi():
    """Allows dynamic ROI polygon updates from frontend UI configuration."""
    global detector
    data = request.get_json(silent=True) or {}
    coords = data.get("coords")
    if not coords or not isinstance(coords, list) or len(coords) < 3:
        return jsonify({"success": False, "error": "Invalid ROI coordinates array. Must contain at least 3 [x,y] points."}), 400
    
    formatted_coords = []
    for pt in coords:
        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
            formatted_coords.append((int(pt[0]), int(pt[1])))
            
    detector.set_custom_roi(formatted_coords)
    return jsonify({"success": True, "message": "ROI polygon updated successfully", "roi_coords": detector.default_roi_coords})

@app.route('/upload_video', methods=['POST'])
@login_required
def upload_video():
    global CURRENT_VIDEO_SOURCE, detector
    target_page = request.referrer or url_for('dashboard')
    if 'file' not in request.files:
        return redirect(target_page)
    
    file = request.files['file']
    if file.filename == '':
        return redirect(target_page)
        
    if file:
        file_path = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(file_path)
        
        CURRENT_VIDEO_SOURCE = file_path
        detector.intruder_memory_frames = 0
        print(f"[System Update] Processing video source updated: {CURRENT_VIDEO_SOURCE}")
        
    return redirect(target_page)

@app.route('/reset_video', methods=['POST', 'GET'])
@login_required
def reset_video():
    """Stops the active video stream and returns system to standby mode."""
    global CURRENT_VIDEO_SOURCE, CURRENT_TELEMETRY, LAST_LOGGED_STATE, detector
    CURRENT_VIDEO_SOURCE = None
    CURRENT_TELEMETRY = dict(STANDBY_TELEMETRY)
    LAST_LOGGED_STATE = "SAFE"
    detector.intruder_memory_frames = 0
    print("[System Update] Video source cleared. System returned to standby mode.")
    target_page = request.referrer or url_for('dashboard')
    return redirect(target_page)

@app.route('/api/logs')
@app.route('/api/incidents')
def api_logs():
    raw_logs = get_all_logs()
    sanitized = []
    for r in raw_logs:
        row_list = list(r)
        if row_list[9] == float('inf') or row_list[9] is None or row_list[9] > 9999.0:
            row_list[9] = 999.0
        if row_list[7] == float('inf') or row_list[7] is None:
            row_list[7] = 0.0
        if row_list[8] == float('inf') or row_list[8] is None:
            row_list[8] = 0.0
        sanitized.append(row_list)
    return jsonify(sanitized)

@app.route('/api/acknowledge-alert', methods=['POST'])
def api_acknowledge_alert():
    """Acknowledge active alert from control room."""
    data = request.get_json(silent=True) or {}
    operator = session.get('user', 'Control Room Operator')
    alert_id = data.get('alert_id', 'ACTIVE')
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    return jsonify({
        "success": True,
        "message": f"Alert {alert_id} acknowledged by {operator} at {timestamp}",
        "acknowledged_by": operator,
        "timestamp": timestamp
    })


@app.route('/api/verify_chain')
def api_verify_chain():
    is_valid, corrupted_id = verify_hash_chain()
    return jsonify({"integrity_valid": is_valid, "corrupted_id": corrupted_id})

@app.route('/api/workers', methods=['GET', 'POST', 'DELETE'])
def api_workers():
    if request.method == 'GET':
        return jsonify(get_all_workers())
        
    elif request.method == 'POST':
        emp_id = request.form.get('employee_id')
        name = request.form.get('name')
        dept = request.form.get('department')
        file = request.files.get('face_image')
        
        if not emp_id or not name or not dept or not file:
            return jsonify({"success": False, "error": "Missing required fields"}), 400
            
        ext = os.path.splitext(file.filename)[1] or ".jpg"
        image_path = os.path.join(FACES_FOLDER, f"{emp_id}{ext}")
        file.save(image_path)
        
        add_worker(emp_id, name, dept, image_path)
        return jsonify({"success": True, "message": f"Worker {emp_id} registered successfully"})
        
    elif request.method == 'DELETE':
        emp_id = request.args.get('employee_id')
        if not emp_id:
            return jsonify({"success": False, "error": "Missing employee_id"}), 400
        delete_worker(emp_id)
        return jsonify({"success": True, "message": f"Worker {emp_id} deleted"})

@app.route('/api/analytics')
def api_analytics():
    return jsonify(get_analytics_summary())

@app.route('/api/auth_status')
def api_auth_status():
    return jsonify({
        "authenticated": 'user' in session,
        "user": session.get('user'),
        "role": session.get('role', 'guest')
    })

@app.route('/api/verify_face_test', methods=['POST'])
@login_required
def api_verify_face_test():
    """Allows operators to upload a photo to test against registered workers database."""
    if 'face_image' not in request.files:
        return jsonify({"success": False, "error": "No image file provided"}), 400
    file = request.files['face_image']
    if file.filename == '':
        return jsonify({"success": False, "error": "Empty filename"}), 400

    file_bytes = file.read()
    is_auth, best_worker, score, details = verify_image_file(file_bytes)
    return jsonify({
        "success": True,
        "is_authorized": is_auth,
        "best_worker": best_worker,
        "confidence": score,
        "details": details
    })

if __name__ == '__main__':
    init_db()
    print("[OK] Railway Track Intrusion Detection Backend Server started on port 5000...")
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)

