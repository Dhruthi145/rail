import sqlite3
import hashlib
import time
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "railway_safety.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Authorized Workers Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS authorized_workers (
            employee_id TEXT PRIMARY KEY,
            name TEXT,
            department TEXT,
            face_image_path TEXT,
            registered_at TEXT
        )
    ''')
    # Check if registered_at column exists
    cursor.execute("PRAGMA table_info(authorized_workers)")
    cols = [col[1] for col in cursor.fetchall()]
    if "registered_at" not in cols:
        try:
            cursor.execute("ALTER TABLE authorized_workers ADD COLUMN registered_at TEXT")
        except Exception:
            pass

    
    # Tamper-Evident Incident Logs Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS incident_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            camera_id TEXT,
            location TEXT,
            person_status TEXT,
            worker_id TEXT,
            train_status TEXT,
            train_speed REAL,
            distance REAL,
            ttc REAL,
            risk_level TEXT,
            alert_status TEXT,
            prev_hash TEXT,
            current_hash TEXT
        )
    ''')

    # Operators Authentication Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS operators (
            username TEXT PRIMARY KEY,
            password_hash TEXT,
            role TEXT,
            created_at TEXT,
            last_login TEXT
        )
    ''')

    # Seed Default Operator and Admin Accounts if not existing
    from werkzeug.security import generate_password_hash
    default_operators = [
        ("OPERATOR_01", generate_password_hash("admin123"), "operator"),
        ("ADMIN", generate_password_hash("railadmin2026"), "admin")
    ]
    for uname, p_hash, role in default_operators:
        cursor.execute("SELECT username FROM operators WHERE username = ?", (uname,))
        if not cursor.fetchone():
            now_str = time.strftime('%Y-%m-%d %H:%M:%S')
            cursor.execute('''
                INSERT INTO operators (username, password_hash, role, created_at, last_login)
                VALUES (?, ?, ?, ?, ?)
            ''', (uname, p_hash, role, now_str, None))

    # Migration: Sanitize worker image paths from absolute OS paths to web-relative paths
    cursor.execute("SELECT employee_id, face_image_path FROM authorized_workers")
    rows = cursor.fetchall()
    for emp_id, img_path in rows:
        if img_path:
            filename = os.path.basename(img_path)
            rel_path = f"database/authorized_faces/{filename}"
            if img_path != rel_path:
                cursor.execute("UPDATE authorized_workers SET face_image_path = ? WHERE employee_id = ?", (rel_path, emp_id))

    conn.commit()
    conn.close()

def authenticate_operator(username, password):
    """
    Verifies operator credentials.
    Returns: (is_authenticated: bool, operator_data: dict or None)
    """
    from werkzeug.security import check_password_hash
    if not username or not password:
        return False, None

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT username, password_hash, role, created_at, last_login FROM operators WHERE username = ?", (username.strip(),))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        return False, None

    uname, p_hash, role, created_at, last_login = row
    if check_password_hash(p_hash, password.strip()):
        now_str = time.strftime('%Y-%m-%d %H:%M:%S')
        cursor.execute("UPDATE operators SET last_login = ? WHERE username = ?", (now_str, uname))
        conn.commit()
        conn.close()
        return True, {
            "username": uname,
            "role": role,
            "created_at": created_at,
            "last_login": now_str
        }

    conn.close()
    return False, None

def get_operator(username):
    """Retrieves operator profile without password hash."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT username, role, created_at, last_login FROM operators WHERE username = ?", (username,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return {
            "username": row[0],
            "role": row[1],
            "created_at": row[2],
            "last_login": row[3]
        }
    return None

def log_incident(camera_id, location, person_status, worker_id, train_status, 
                 train_speed, distance, ttc, risk_level, alert_status):
    """
    Appends an incident to the ledger with a cryptographic SHA-256 hash link.
    Formula: Hash_n = SHA256(Data_n + Hash_{n-1})
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Fetch last record's hash to chain
    cursor.execute("SELECT current_hash FROM incident_logs ORDER BY id DESC LIMIT 1")
    row = cursor.fetchone()
    prev_hash = row[0] if row else "GENESIS_BLOCK_00000000000000000000000000000000"
    
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    
    # Concatenate fields for block payload
    raw_data = f"{timestamp}|{camera_id}|{location}|{person_status}|{worker_id}|{train_status}|{train_speed:.1f}|{distance:.1f}|{ttc:.2f}|{risk_level}|{alert_status}|{prev_hash}"
    current_hash = hashlib.sha256(raw_data.encode('utf-8')).hexdigest()
    
    cursor.execute('''
        INSERT INTO incident_logs (
            timestamp, camera_id, location, person_status, worker_id, 
            train_status, train_speed, distance, ttc, risk_level, alert_status, 
            prev_hash, current_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (timestamp, camera_id, location, person_status, worker_id, train_status,
          train_speed, distance, ttc, risk_level, alert_status, prev_hash, current_hash))
    
    conn.commit()
    conn.close()
    return current_hash

def get_all_logs(limit=100):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM incident_logs ORDER BY id DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return rows

def verify_hash_chain():
    """
    Validates integrity of the hash chain to detect any tampering.
    Returns: (is_valid: bool, tampered_row_id: int or None)
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM incident_logs ORDER BY id ASC")
    rows = cursor.fetchall()
    conn.close()
    
    if not rows:
        return True, None

    # Anchor to the first available record's prev_hash (genesis or chain anchor)
    prev_hash = rows[0][12]
    for row in rows:
        row_id, timestamp, cam_id, loc, p_stat, w_id, t_stat, speed, dist, ttc, r_lvl, a_stat, stored_prev, stored_curr = row
        
        if stored_prev != prev_hash:
            return False, row_id
            
        raw_data = f"{timestamp}|{cam_id}|{loc}|{p_stat}|{w_id}|{t_stat}|{speed:.1f}|{dist:.1f}|{ttc:.2f}|{r_lvl}|{a_stat}|{stored_prev}"
        computed_hash = hashlib.sha256(raw_data.encode('utf-8')).hexdigest()
        
        if computed_hash != stored_curr:
            return False, row_id
            
        prev_hash = stored_curr
        
    return True, None

def get_all_workers():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT employee_id, name, department, face_image_path, registered_at FROM authorized_workers ORDER BY employee_id ASC")
    rows = cursor.fetchall()
    conn.close()
    result = []
    for r in rows:
        img = r[3]
        if img:
            filename = os.path.basename(img)
            clean_img = f"database/authorized_faces/{filename}"
        else:
            clean_img = ""
        result.append({
            "employee_id": r[0],
            "name": r[1],
            "department": r[2],
            "face_image_path": clean_img,
            "registered_at": r[4]
        })
    return result

def add_worker(emp_id, name, department, face_image_path):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    registered_at = time.strftime('%Y-%m-%d %H:%M:%S')
    filename = os.path.basename(face_image_path)
    clean_path = f"database/authorized_faces/{filename}"
    cursor.execute('''
        INSERT OR REPLACE INTO authorized_workers (employee_id, name, department, face_image_path, registered_at)
        VALUES (?, ?, ?, ?, ?)
    ''', (emp_id, name, department, clean_path, registered_at))
    conn.commit()
    conn.close()

def delete_worker(emp_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM authorized_workers WHERE employee_id = ?", (emp_id,))
    conn.commit()
    conn.close()

def get_analytics_summary():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM incident_logs")
    total_incidents = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM incident_logs WHERE risk_level LIKE '%CRITICAL%'")
    critical_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM incident_logs WHERE risk_level LIKE '%High%'")
    high_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM incident_logs WHERE risk_level LIKE '%Medium%' or risk_level LIKE '%WARNING%'")
    warning_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM incident_logs WHERE person_status = 'AUTHORIZED'")
    authorized_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM incident_logs WHERE person_status != 'AUTHORIZED' AND person_status != 'NO_PERSON'")
    unauthorized_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM authorized_workers")
    total_registered_workers = cursor.fetchone()[0]

    conn.close()
    
    return {
        "total_incidents": total_incidents,
        "critical_count": critical_count,
        "high_count": high_count,
        "warning_count": warning_count,
        "authorized_count": authorized_count,
        "unauthorized_count": unauthorized_count,
        "total_registered_workers": total_registered_workers
    }

if __name__ == "__main__":
    init_db()
    print("[OK] Database initialized with hash-chain ledger support.")
