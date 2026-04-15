import os
import shutil
import uuid
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory Store for the 8 slots
slots = []
for i in range(8):
    slots.append({"id": i, "type": "empty", "content": "", "filename": ""})

# Setup uploads and static directory
os.makedirs("uploads", exist_ok=True)
os.makedirs("static", exist_ok=True)

# Mount static files to serve the web application and uploads
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

@app.get("/api/board")
async def get_board():
    return slots

@app.post("/api/board/{slot_id}/text")
async def upload_text(slot_id: int, content: str = Form(...)):
    if slot_id < 0 or slot_id > 7:
        raise HTTPException(status_code=400, detail="Invalid slot")
    slots[slot_id] = {"id": slot_id, "type": "text", "content": content, "filename": ""}
    return {"status": "success", "slot": slots[slot_id]}

@app.post("/api/board/{slot_id}/file")
async def upload_file(slot_id: int, file: UploadFile = File(...)):
    if slot_id < 0 or slot_id > 7:
        raise HTTPException(status_code=400, detail="Invalid slot")
    
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1] if file.filename else ""
    filename = f"{file_id}{ext}"
    file_path = f"uploads/{filename}"
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    mime_type = file.content_type or ""
    slot_type = "image" if mime_type.startswith("image/") else "file"
    
    slots[slot_id] = {
        "id": slot_id, 
        "type": slot_type, 
        "content": file_path, 
        "filename": file.filename
    }
    return {"status": "success", "slot": slots[slot_id]}

@app.delete("/api/board/{slot_id}")
async def delete_slot(slot_id: int):
    if slot_id < 0 or slot_id > 7:
        raise HTTPException(status_code=400, detail="Invalid slot")
    # Clean up the file from disk if it was a file
    existing = slots[slot_id]
    if existing["type"] in ["file", "image"] and os.path.exists(existing["content"]):
        try:
            os.remove(existing["content"])
        except Exception:
            pass
    
    slots[slot_id] = {"id": slot_id, "type": "empty", "content": "", "filename": ""}
    return {"status": "success"}

@app.get("/uploads/{filename}")
async def get_file(filename: str):
    file_path = f"uploads/{filename}"
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    # Tell the browser to download it instead of just displaying if it's a file
    return FileResponse(file_path, filename=filename)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=16968, reload=True)
