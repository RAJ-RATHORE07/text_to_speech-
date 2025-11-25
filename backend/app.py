# backend/app.py
from flask import Flask, request, send_file, jsonify, send_from_directory
from flask_cors import CORS
import edge_tts
import asyncio
import uuid
from deep_translator import GoogleTranslator
from langdetect import detect
import os
import xml.sax.saxutils as saxutils
import logging
from pathlib import Path
from werkzeug.utils import secure_filename
import json
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
from datetime import datetime, timedelta

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tts-backend")

app = Flask(__name__)
# In production replace "*" with your frontend origin
CORS(app, resources={r"/api/*": {"origins": "*"}}, expose_headers=["X-Detected-Lang"])

BASE_DIR = Path.cwd()
OUT_DIR = BASE_DIR / "generated"
SAVED_DIR = BASE_DIR / "saved"
OUT_DIR.mkdir(exist_ok=True)
SAVED_DIR.mkdir(exist_ok=True)

USERS_FILE = SAVED_DIR / "users.json"
if not USERS_FILE.exists():
    USERS_FILE.write_text("[]", encoding="utf-8")

JWT_SECRET = os.environ.get("TTS_JWT_SECRET", "change-me-to-a-strong-secret")
JWT_ALGO = "HS256"
JWT_EXP_SECONDS = int(os.environ.get("TTS_JWT_EXP_SECONDS", 60 * 60 * 24))

# --- VOICES and helpers (same as before) ---
VOICES = [
    {
        "lang": "English (US)",
        "code": "en-US",
        "voices": [
            {"label": "Aria (F) - Bright", "value": "en-US-AriaNeural", "gender": "female", "style": "cheerful", "pitch_offset": 0.12, "rate_offset": 0.05},
            {"label": "Jessa (F) - Warm",  "value": "en-US-JessaNeural", "gender": "female", "style": "empathetic", "pitch_offset": -0.08, "rate_offset": -0.02},
            {"label": "Guy (M) - Neutral", "value": "en-US-GuyNeural", "gender": "male",   "style": None, "pitch_offset": -0.05, "rate_offset": 0.0},
            {"label": "Ryan (M) - Deep",   "value": "en-US-RyanNeural", "gender": "male",   "style": "newscast", "pitch_offset": -0.25, "rate_offset": -0.05},
        ],
    },
    {
        "lang": "Hindi (IN)",
        "code": "hi-IN",
        "voices": [
            {"label": "Swara (F) - Bright",   "value": "hi-IN-SwaraNeural",   "gender": "female", "style": "cheerful",    "pitch_offset": 0.15, "rate_offset": 0.05},
            {"label": "Nandini (F) - Warm",   "value": "hi-IN-NandiniNeural", "gender": "female", "style": "empathetic", "pitch_offset": -0.06, "rate_offset": -0.03},
            {"label": "Madhur (M) - Neutral", "value": "hi-IN-MadhurNeural",  "gender": "male",   "style": None,        "pitch_offset": -0.05, "rate_offset": 0.0},
            {"label": "Rohan (M) - Rich",     "value": "hi-IN-RohanNeural",  "gender": "male",   "style": "narration",  "pitch_offset": -0.18, "rate_offset": -0.04},
        ],
    },
    {
        "lang": "Spanish (ES)",
        "code": "es-ES",
        "voices": [
            {"label": "Elvira (F)", "value": "es-ES-ElviraNeural", "gender": "female", "style": "cheerful", "pitch_offset": 0.1,  "rate_offset": 0.04},
            {"label": "Lucia (F)",  "value": "es-ES-LuciaNeural",  "gender": "female", "style": "empathetic","pitch_offset": -0.07, "rate_offset": -0.02},
            {"label": "Pablo (M)",  "value": "es-ES-PabloNeural",  "gender": "male",   "style": None,        "pitch_offset": -0.06, "rate_offset": 0.0},
            {"label": "Jorge (M)",  "value": "es-ES-JorgeNeural",  "gender": "male",   "style": "newscast",  "pitch_offset": -0.2,  "rate_offset": -0.05},
        ],
    },
    {
        "lang": "French (FR)",
        "code": "fr-FR",
        "voices": [
            {"label": "Julie (F)",  "value": "fr-FR-JulieNeural",  "gender": "female", "style": "cheerful",  "pitch_offset": 0.08, "rate_offset": 0.03},
            {"label": "Camille (F)","value": "fr-FR-CamilleNeural","gender": "female", "style": "narration", "pitch_offset": -0.05,"rate_offset": -0.02},
            {"label": "Henri (M)",  "value": "fr-FR-HenriNeural",  "gender": "male",   "style": None,        "pitch_offset": -0.12,"rate_offset": 0.0},
            {"label": "Louis (M)",  "value": "fr-FR-LouisNeural",  "gender": "male",   "style": "newscast",  "pitch_offset": -0.22,"rate_offset": -0.05},
        ],
    },
]

def escape_xml(s: str) -> str:
    import xml.sax.saxutils as su
    return su.escape(s)

def find_voice_meta(voice_value: str):
    for block in VOICES:
        for v in block.get("voices", []):
            if v.get("value") == voice_value:
                return v
    return None

def clamp(x, lo, hi):
    try:
        xv = float(x)
        if xv < lo: return lo
        if xv > hi: return hi
        return xv
    except:
        return x

def get_language_code(voice_name: str) -> str:
    if not voice_name:
        return ""
    parts = voice_name.split("-")
    if len(parts) >= 2: return f"{parts[0]}-{parts[1]}"
    return parts[0]

def build_ssml(text, voice, pitch, rate, volume, tone, use_express=True):
    # Keep SSML minimal (edge-tts handles some wrapping)
    safe = escape_xml(text)
    return safe

async def synthesize_ssml_to_file(ssml_text, voice, out_path):
    communicate = edge_tts.Communicate(ssml_text, voice)
    await communicate.save(out_path)

# JWT helpers
def create_jwt(payload: dict, exp_seconds: int = 60*60*24):
    p = payload.copy()
    p["exp"] = datetime.utcnow() + timedelta(seconds=exp_seconds)
    token = jwt.encode(p, JWT_SECRET, algorithm=JWT_ALGO)
    return token

def decode_jwt(token: str):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception as e:
        logger.info("JWT decode failed: %s", e)
        return None

def load_users():
    try:
        return json.loads(USERS_FILE.read_text(encoding="utf-8") or "[]")
    except Exception:
        return []

def save_users(users):
    USERS_FILE.write_text(json.dumps(users, ensure_ascii=False, indent=2), encoding="utf-8")

def find_user_by_email(email):
    users = load_users()
    for u in users:
        if u.get("email") == email:
            return u
    return None

def require_auth():
    auth = request.headers.get("Authorization", "")
    if not auth or not auth.lower().startswith("bearer "):
        return None
    token = auth.split(" ", 1)[1].strip()
    data = decode_jwt(token)
    return data

# --- Auth endpoints
@app.route("/api/register", methods=["POST"])
def api_register():
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    name = data.get("name") or ""
    if not email or not password:
        return jsonify({"ok": False, "error": "email + password required"}), 400
    if find_user_by_email(email):
        return jsonify({"ok": False, "error": "account exists"}), 409

    users = load_users()
    hashed = generate_password_hash(password)
    user = {"id": uuid.uuid4().hex, "email": email, "name": name or email, "password_hash": hashed, "createdAt": int(datetime.utcnow().timestamp())}
    users.append(user)
    save_users(users)
    token = create_jwt({"sub": user["id"], "email": user["email"], "name": user["name"]})
    return jsonify({"ok": True, "token": token, "user": {"id": user["id"], "email": user["email"], "name": user["name"]}})

@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify({"ok": False, "error": "email + password required"}), 400
    user = find_user_by_email(email)
    if not user or not check_password_hash(user.get("password_hash", ""), password):
        return jsonify({"ok": False, "error": "invalid credentials"}), 401
    token = create_jwt({"sub": user["id"], "email": user["email"], "name": user["name"]})
    return jsonify({"ok": True, "token": token, "user": {"id": user["id"], "email": user["email"], "name": user["name"]}})

@app.route("/api/me", methods=["GET"])
def api_me():
    data = require_auth()
    if not data:
        return jsonify({"ok": False, "error": "unauthenticated"}), 401
    return jsonify({"ok": True, "user": {"id": data.get("sub"), "email": data.get("email"), "name": data.get("name")}})

# Voices list
@app.route("/api/voices", methods=["GET"])
def list_voices():
    normalized = []
    for block in VOICES:
        b = {"lang": block.get("lang"), "code": block.get("code"), "voices": []}
        for v in block.get("voices", []):
            vcopy = v.copy()
            vcopy["gender"] = (vcopy.get("gender") or "").strip().lower()
            vcopy["label"] = vcopy.get("label") or vcopy.get("value") or ""
            vcopy["value"] = vcopy.get("value") or vcopy.get("label") or ""
            b["voices"].append(vcopy)
        normalized.append(b)
    return jsonify(normalized)

# Speak (generates mp3 in saved/ and returns blob)
@app.route("/api/speak", methods=["POST"])
def speak():
    data = request.get_json(force=True) or {}
    text = (data.get("text") or "").strip()
    voice = data.get("voice") or (VOICES[0]["voices"][0]["value"])
    pitch = data.get("pitch", "0")
    rate = data.get("rate", "1.0")
    volume = data.get("volume", "1.0")
    tone = data.get("tone", "none")

    if not text:
        return jsonify({"error": "No text provided"}), 400

    try:
        detected_lang = detect(text)
    except Exception:
        detected_lang = ""

    target_lang_full = get_language_code(voice)
    target_lang_short = target_lang_full.split("-")[0] if target_lang_full else ""

    translated_text = text
    try:
        if detected_lang and target_lang_short and detected_lang.lower() != target_lang_short.lower():
            translated_text = GoogleTranslator(source=detected_lang, target=target_lang_short).translate(text)
    except Exception:
        translated_text = text

    tmp_path = OUT_DIR / f"{uuid.uuid4().hex}.mp3"
    out_path = str(tmp_path)

    attempts = []
    candidates = [(voice, True, "requested with express"), (voice, False, "requested without express")]

    # add fallbacks from same language
    lang_code = target_lang_full
    for b in VOICES:
        if b.get("code") == lang_code or b.get("lang") == lang_code:
            for v in b.get("voices", []):
                if v.get("value") != voice:
                    candidates.append((v["value"], True, "language fallback with express"))
                    candidates.append((v["value"], False, "language fallback without express"))
            break

    success = False
    for idx, (cand_voice, use_expr, reason) in enumerate(candidates):
        try:
            ssml = build_ssml(translated_text, cand_voice, pitch, rate, volume, tone, use_express=use_expr)
            logger.info(f"Attempt {idx+1}: voice={cand_voice} express={use_expr} ({reason})")
            asyncio.run(synthesize_ssml_to_file(ssml, cand_voice, out_path))
            if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                attempts.append({"voice": cand_voice, "use_express": use_expr, "ok": True})
                success = True
                break
            else:
                attempts.append({"voice": cand_voice, "use_express": use_expr, "ok": False, "error": "empty output"})
        except Exception as e:
            attempts.append({"voice": cand_voice, "use_express": use_expr, "ok": False, "error": str(e)})
            logger.warning(f"Attempt failed: {e}")
            try:
                if os.path.exists(out_path): os.remove(out_path)
            except: pass
            continue

    headers = {}
    if detected_lang:
        headers["X-Detected-Lang"] = detected_lang.upper()

    if not success:
        try:
            if os.path.exists(out_path): os.remove(out_path)
        except: pass
        return jsonify({"error": "TTS generation failed for all attempts.", "attempts": attempts}), 500

    # return blob success
    return send_file(out_path, mimetype="audio/mpeg", as_attachment=False,
                     download_name=f"speech_{uuid.uuid4().hex}.mp3"), 200, headers

@app.route("/api/validate-voice", methods=["GET"])
def validate_voice():
    v = request.args.get("voice")
    if not v: return jsonify({"ok": False, "error": "voice param required"}), 400
    tmp = OUT_DIR / f"{uuid.uuid4().hex}_val.mp3"
    try:
        ssml = build_ssml("This is a quick voice validation sample.", v, "0", "1.0", "1.0", "none")
        asyncio.run(synthesize_ssml_to_file(ssml, v, str(tmp)))
        ok = os.path.exists(str(tmp)) and os.path.getsize(str(tmp)) > 0
        return jsonify({"ok": ok})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    finally:
        try:
            if tmp.exists(): tmp.unlink()
        except: pass

# Serve saved files publicly at /files/<filename>
@app.route("/files/<path:filename>", methods=["GET"])
def serve_saved_file(filename):
    # sanitize: only allow files under SAVED_DIR
    try:
        # send_from_directory handles path traversal safety
        return send_from_directory(str(SAVED_DIR), filename, as_attachment=True)
    except Exception as e:
        logger.warning("serve_saved_file failed: %s", e)
        return jsonify({"error": "file not found"}), 404

# Upload: requires auth; store public_url
@app.route("/api/upload", methods=["POST"])
def upload_file():
    user = require_auth()
    if not user:
        return jsonify({"error": "authentication required"}), 401

    if "file" not in request.files:
        return jsonify({"error": "no file part"}), 400
    file = request.files["file"]
    title = request.form.get("title", "")
    tags_raw = request.form.get("tags", "")
    tags = [t.strip() for t in tags_raw.split(",")] if tags_raw else []

    if file.filename == "":
        return jsonify({"error": "no selected file"}), 400

    filename = secure_filename(file.filename)
    unique = f"{uuid.uuid4().hex}_{filename}"
    dest = SAVED_DIR / unique
    try:
        file.save(str(dest))
        # build public URL that clients can download
        base = request.url_root.rstrip('/')
        public_url = f"{base}/files/{dest.name}"
        meta = {
            "id": Path(dest).stem,
            "file": str(dest),
            "filename": filename,
            "public_url": public_url,
            "title": title or filename,
            "tags": tags,
            "createdAt": int(dest.stat().st_mtime),
            "owner": {"id": user.get("sub"), "email": user.get("email")}
        }
        meta_path = SAVED_DIR / f"{meta['id']}.json"
        meta_path.write_text(json.dumps(meta, ensure_ascii=False))
        return jsonify({"ok": True, "meta": meta})
    except Exception as e:
        logger.error("upload failed: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/history", methods=["GET"])
def get_history():
    user = require_auth()
    items = []
    for p in SAVED_DIR.glob("*.json"):
        try:
            j = json.loads(p.read_text())
            items.append(j)
        except:
            continue
    items = sorted(items, key=lambda x: x.get("createdAt", 0), reverse=True)
    if user:
        uid = user.get("sub")
        items = [it for it in items if it.get("owner", {}).get("id") == uid]
    return jsonify(items)

if __name__ == "__main__":
    logger.info("Starting TTS backend (auth-enabled)")
    # In production you will run via gunicorn; this is dev mode
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
