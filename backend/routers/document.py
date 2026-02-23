import os
import uuid
from typing import List

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from services.ocr_service import run_ocr
from services.pdf_service import get_pdf_info, get_page_thumbnail, split_pdf

ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}

router = APIRouter(prefix="/documents", tags=["documents"])

TEMP_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "temp")
os.makedirs(TEMP_DIR, exist_ok=True)

# In-memory store — sufficient for local single-user use
_documents: dict = {}
_results: dict = {}

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


class ProcessRequest(BaseModel):
    page_ranges: List[List[int]]  # [[start, end], ...] — 1-indexed, inclusive


@router.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename.lower())[1]
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, "支援格式：PDF、JPG、PNG")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "File exceeds 50 MB limit")

    doc_id = str(uuid.uuid4())
    is_image = ext in IMAGE_EXTENSIONS
    file_path = os.path.join(TEMP_DIR, f"{doc_id}{ext}")
    with open(file_path, "wb") as f:
        f.write(content)

    if is_image:
        total_pages = 1
    else:
        total_pages = get_pdf_info(file_path)["total_pages"]

    _documents[doc_id] = {
        "path": file_path,
        "filename": file.filename,
        "total_pages": total_pages,
        "is_image": is_image,
    }

    return {
        "doc_id": doc_id,
        "filename": file.filename,
        "total_pages": total_pages,
        "is_image": is_image,
    }


@router.get("/{doc_id}/thumbnail/{page_num}")
def get_thumbnail(doc_id: str, page_num: int):
    """page_num is 1-indexed"""
    if doc_id not in _documents:
        raise HTTPException(404, "Document not found")
    doc = _documents[doc_id]

    if doc["is_image"]:
        # Return the image file directly
        with open(doc["path"], "rb") as f:
            content = f.read()
        ext = os.path.splitext(doc["path"])[1].lower()
        mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
        return Response(content=content, media_type=mime)

    try:
        img = get_page_thumbnail(doc["path"], page_num - 1)
        return Response(content=img, media_type="image/png")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{doc_id}/ocr")
async def process_ocr(doc_id: str, req: ProcessRequest):
    if doc_id not in _documents:
        raise HTTPException(404, "Document not found")

    doc = _documents[doc_id]

    # Images: OCR directly, no splitting needed
    if doc["is_image"]:
        result = await run_ocr(doc["path"])
        _results[doc_id] = result
        return result

    # PDF: split to selected pages first
    if not req.page_ranges:
        raise HTTPException(400, "No page ranges specified")

    split_path = os.path.join(TEMP_DIR, f"{doc_id}_split.pdf")
    split_pdf(doc["path"], req.page_ranges, split_path)

    try:
        result = await run_ocr(split_path)
        _results[doc_id] = result
        return result
    finally:
        if os.path.exists(split_path):
            os.remove(split_path)


@router.get("/{doc_id}/download/{fmt}")
def download_result(doc_id: str, fmt: str):
    if doc_id not in _results:
        raise HTTPException(404, "No OCR result — run OCR first")
    if fmt not in ("md", "txt"):
        raise HTTPException(400, "Format must be 'md' or 'txt'")

    result = _results[doc_id]
    doc = _documents[doc_id]
    base_name = os.path.splitext(doc["filename"])[0]
    content = result["markdown"] if fmt == "md" else result["txt"]

    out_path = os.path.join(TEMP_DIR, f"{doc_id}_output.{fmt}")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(content)

    return FileResponse(
        out_path,
        filename=f"{base_name}.{fmt}",
        media_type="text/plain; charset=utf-8",
    )
