import os
import base64
from mistralai import Mistral
from dotenv import load_dotenv

load_dotenv()

OCR_MODEL = "mistral-ocr-2512"

IMAGE_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".avif": "image/avif",
}


def get_client() -> Mistral:
    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        raise RuntimeError("MISTRAL_API_KEY not set in .env")
    return Mistral(api_key=api_key)


async def run_ocr(file_path: str) -> dict:
    client = get_client()
    ext = os.path.splitext(file_path)[1].lower()

    with open(file_path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode()

    if ext in IMAGE_MIME:
        mime = IMAGE_MIME[ext]
        document = {
            "type": "image_url",
            "image_url": f"data:{mime};base64,{encoded}",
        }
    else:
        document = {
            "type": "document_url",
            "document_url": f"data:application/pdf;base64,{encoded}",
        }

    result = client.ocr.process(
        model=OCR_MODEL,
        document=document,
        include_image_base64=False,
    )

    pages_md = []
    pages_txt = []

    for i, page in enumerate(result.pages):
        pages_md.append(f"---\n## Page {i + 1}\n---\n\n{page.markdown}")

        # Strip markdown heading markers for plain text
        txt = page.markdown
        for prefix in ["##### ", "#### ", "### ", "## ", "# "]:
            txt = txt.replace(prefix, "")
        pages_txt.append(txt.strip())

    return {
        "markdown": "\n\n".join(pages_md),
        "txt": "\n\n".join(pages_txt),
        "pages_processed": len(result.pages),
    }
