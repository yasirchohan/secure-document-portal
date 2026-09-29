import os
import sqlite3
import datetime

import bcrypt
import jwt
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

# ====== SETTINGS ======
# In production, set SECRET_KEY as an environment variable. Never hardcode it.
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-this-secret-key-1234567890")
ALGORITHM = "HS256"
TOKEN_HOURS = 2
DB_FILE = "portal.db"

app = FastAPI(title="SecureDocs API")

# Allow the frontend (any localhost port) to talk to this backend
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(127\.0\.0\.1|localhost):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

bearer = HTTPBearer()


# ====== DATABASE ======
def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL
        )
    """)
    # Development users only. Remove or change these before real use.
    seed = [
        ("admin@test.com", "Admin@123", "admin"),
        ("employee@test.com", "Employee@123", "employee"),
    ]
    for email, pw, role in seed:
        exists = conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
        if not exists:
            conn.execute(
                "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)",
                (email, hash_password(pw), role),
            )
    conn.commit()
    conn.close()


init_db()


# ====== JWT ======
def create_token(email: str, role: str) -> str:
    payload = {
        "sub": email,
        "role": role,
        "exp": datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(hours=TOKEN_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    try:
        payload = jwt.decode(creds.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        return {"email": payload["sub"], "role": payload["role"]}
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# ====== ENDPOINTS ======
class LoginData(BaseModel):
    email: str
    password: str


@app.post("/login")
def login(data: LoginData):
    conn = get_db()
    # "?" placeholder = parameterized query, protects against SQL injection
    user = conn.execute(
        "SELECT * FROM users WHERE email = ?", (data.email.strip().lower(),)
    ).fetchone()
    conn.close()

    # Same error for wrong email and wrong password, so attackers can't tell which is wrong
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    return {"token": create_token(user["email"], user["role"]), "role": user["role"]}


@app.get("/me")
def me(user: dict = Depends(get_current_user)):
    return user

import io
import uuid
from fastapi import UploadFile, File, Form
from fastapi.responses import FileResponse
from cryptography.fernet import Fernet

# ====== ENCRYPTION SETUP ======
KEY_FILE = "secret.key"
STORAGE_DIR = "encrypted_files"
os.makedirs(STORAGE_DIR, exist_ok=True)

def load_or_create_key():
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "rb") as f:
            return f.read()
    key = Fernet.generate_key()
    with open(KEY_FILE, "wb") as f:
        f.write(key)
    return key

fernet = Fernet(load_or_create_key())


# ====== DB TABLE FOR FILES ======
def init_files_table():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            allowed_role TEXT NOT NULL,
            uploaded_by TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()

init_files_table()


# ====== UPLOAD (encrypts the file, saves who can access it) ======
@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    allowed_role: str = Form(...),
    user: dict = Depends(get_current_user),
):
    if allowed_role not in ("admin", "employee"):
        raise HTTPException(status_code=400, detail="Invalid role")

    raw_bytes = await file.read()
    if len(raw_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    encrypted = fernet.encrypt(raw_bytes)

    doc_id = str(uuid.uuid4())
    stored_name = doc_id + ".enc"
    with open(os.path.join(STORAGE_DIR, stored_name), "wb") as f:
        f.write(encrypted)

    conn = get_db()
    conn.execute(
        "INSERT INTO documents (id, original_name, stored_name, allowed_role, uploaded_by) "
        "VALUES (?, ?, ?, ?, ?)",
        (doc_id, file.filename, stored_name, allowed_role, user["email"]),
    )
    conn.commit()
    conn.close()

    return {"id": doc_id, "filename": file.filename, "allowed_role": allowed_role}


# ====== LIST FILES (only ones this user's role is allowed to see) ======
@app.get("/documents")
def list_documents(user: dict = Depends(get_current_user)):
    conn = get_db()
    if user["role"] == "admin":
        rows = conn.execute("SELECT id, original_name, allowed_role FROM documents").fetchall()
    else:
        rows = conn.execute(
            "SELECT id, original_name, allowed_role FROM documents WHERE allowed_role = ?",
            (user["role"],),
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ====== ASK (demo answer for now — the AI team's RAG model plugs in here later) ======
class AskData(BaseModel):
    question: str

@app.post("/ask")
def ask_question(data: AskData, user: dict = Depends(get_current_user)):
    conn = get_db()
    if user["role"] == "admin":
        rows = conn.execute("SELECT original_name FROM documents").fetchall()
    else:
        rows = conn.execute(
            "SELECT original_name FROM documents WHERE allowed_role = ?", (user["role"],)
        ).fetchall()
    conn.close()

    visible_files = [r["original_name"] for r in rows]
    if not visible_files:
        answer = "No documents are available to you yet. Ask an admin to upload one."
    else:
        # Placeholder until the AI team's RAG model is connected.
        answer = (
            f"(Demo) I can see {len(visible_files)} document(s) you're allowed to access: "
            f"{', '.join(visible_files)}. The real AI-generated answer will appear here "
            f"once the AI team's RAG model is connected."
        )
    return {"answer": answer}