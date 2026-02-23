import fitz  # PyMuPDF


def get_pdf_info(pdf_path: str) -> dict:
    doc = fitz.open(pdf_path)
    info = {"total_pages": len(doc)}
    doc.close()
    return info


def get_page_thumbnail(pdf_path: str, page_num: int, scale: float = 0.4) -> bytes:
    """page_num is 0-indexed"""
    doc = fitz.open(pdf_path)
    if page_num < 0 or page_num >= len(doc):
        raise ValueError(f"Page {page_num} out of range (0-{len(doc) - 1})")
    page = doc[page_num]
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat)
    img_bytes = pix.tobytes("png")
    doc.close()
    return img_bytes


def split_pdf(input_path: str, page_ranges: list, output_path: str) -> str:
    """
    page_ranges: list of [start, end] — 1-indexed, inclusive
    Returns output_path
    """
    src = fitz.open(input_path)
    output = fitz.open()
    for start, end in page_ranges:
        from_page = max(0, start - 1)
        to_page = min(end - 1, len(src) - 1)
        output.insert_pdf(src, from_page=from_page, to_page=to_page)
    output.save(output_path)
    output.close()
    src.close()
    return output_path
