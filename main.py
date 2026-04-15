import os
import shutil
import uuid
import json
import logging
import aiofiles
import asyncio
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

class EndpointFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        # 屏蔽前端高频轮询的访问日志
        if msg.find("GET /api/board HTTP/") != -1:
            return False
        # 屏蔽 favicon 报错日志
        if msg.find("GET /favicon.ico HTTP/") != -1:
            return False
        # 屏蔽包含 http%3A// 的外网探测畸形日志
        if msg.find("http%3A//") != -1:
            return False
        return True

logging.getLogger("uvicorn.access").addFilter(EndpointFilter())

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_FILE = "data.json"

def load_slots():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load {DATA_FILE}: {e}")
    
    # Default 8 slots
    default_slots = []
    for i in range(8):
        default_slots.append({"id": i, "type": "empty", "content": "", "filename": ""})
    return default_slots

slots_lock = asyncio.Lock()

async def save_slots():
    try:
        async with aiofiles.open(DATA_FILE, "w", encoding="utf-8") as f:
            await f.write(json.dumps(slots, ensure_ascii=False, indent=2))
    except Exception as e:
        print(f"Warning: Failed to save {DATA_FILE}: {e}")

# In-memory Store for the 8 slots, loaded from persistent file
slots = load_slots()

def cleanup_slot_file(slot_id: int):
    existing = slots[slot_id]
    if existing["type"] in ["file", "image"] and os.path.exists(existing["content"]):
        try:
            os.remove(existing["content"])
        except Exception as e:
            print(f"Warning: Failed to delete file {existing['content']}: {e}")

# Setup uploads and static directory
os.makedirs("uploads", exist_ok=True)
os.makedirs("static", exist_ok=True)

# Mount static files to serve the web application and uploads
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    # 返回一个空的 204 No Content，避免后台一直报 404
    return Response(content=b"", media_type="image/x-icon", status_code=204)

@app.get("/")
async def root():
    return FileResponse("static/index.html")

@app.get("/api/board")
async def get_board():
    return slots

@app.post("/api/board/{slot_id}/text")
async def upload_text(slot_id: int, content: str = Form(...)):
    if len(content) > 2 * 1024 * 1024:  # 2MB Limit
        raise HTTPException(status_code=413, detail="Text payload too large. Maximum size is 2MB.")
    if slot_id < 0 or slot_id > 7:
        raise HTTPException(status_code=400, detail="Invalid slot")
    
    async with slots_lock:
        cleanup_slot_file(slot_id)
        slots[slot_id] = {"id": slot_id, "type": "text", "content": content, "filename": ""}
        await save_slots()
        
    return {"status": "success", "slot": slots[slot_id]}

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB limit

@app.post("/api/board/{slot_id}/file")
async def upload_file(slot_id: int, request: Request, file: UploadFile = File(...)):
    if slot_id < 0 or slot_id > 7:
        raise HTTPException(status_code=400, detail="Invalid slot")
    
    # Pre-check Content-Length for size limit if the client provides it
    if "content-length" in request.headers:
        if int(request.headers["content-length"]) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File too large. Maximum size is 100MB.")
            
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1] if file.filename else ""
    filename = f"{file_id}{ext}"
    file_path = f"uploads/{filename}"
    
    # Use aiofiles for asynchronous file write handling
    file_size = 0
    async with aiofiles.open(file_path, "wb") as buffer:
        while chunk := await file.read(1024 * 1024):  # 1MB chunks
            file_size += len(chunk)
            if file_size > MAX_FILE_SIZE:
                # Remove partially written file on limit hit
                try:
                    os.remove(file_path)
                except Exception:
                    pass
                raise HTTPException(status_code=413, detail="File too large. Maximum size is 100MB.")
            await buffer.write(chunk)
        
    mime_type = file.content_type or ""
    slot_type = "image" if mime_type.startswith("image/") else "file"
    
    async with slots_lock:
        cleanup_slot_file(slot_id)
        slots[slot_id] = {
            "id": slot_id, 
            "type": slot_type, 
            "content": file_path, 
            "filename": file.filename
        }
        await save_slots()
        
    return {"status": "success", "slot": slots[slot_id]}

@app.delete("/api/board")
async def clear_all_slots():
    async with slots_lock:
        for i in range(8):
            cleanup_slot_file(i)
            slots[i] = {"id": i, "type": "empty", "content": "", "filename": ""}
        await save_slots()
    return {"status": "success"}

@app.delete("/api/board/{slot_id}")
async def delete_slot(slot_id: int):
    if slot_id < 0 or slot_id > 7:
        raise HTTPException(status_code=400, detail="Invalid slot")
        
    async with slots_lock:
        cleanup_slot_file(slot_id)
        slots[slot_id] = {"id": slot_id, "type": "empty", "content": "", "filename": ""}
        await save_slots()
        
    return {"status": "success"}

@app.get("/uploads/{filename}")
async def get_file(filename: str):
    safe_filename = os.path.basename(filename)
    file_path = f"uploads/{safe_filename}"
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    # Tell the browser to download it instead of just displaying if it's a file
    return FileResponse(file_path, filename=filename)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=16968, reload=True)
