#!/usr/bin/env python3
"""Numerical export integrity only; no content review or rendered-page audit."""
import json
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

def normalize(text):
    text = unicodedata.normalize('NFKC', text).replace('‘', "'").replace('’', "'")
    text = text.replace('“', '"').replace('”', '"').replace('**', '').replace('♦', '◆')
    return re.sub(r'\s+', ' ', text).strip()

def check(directory):
    directory = Path(directory)
    english = re.findall(r'^\*\*En:\*\*\s*(.+)$', (directory / 'guide.md').read_text(), re.M)
    with zipfile.ZipFile(directory / 'guide.docx') as archive:
        root = ET.fromstring(archive.read('word/document.xml'))
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    word_english = []
    for paragraph in root.findall('.//w:p', ns):
        text = ''.join(t.text or '' for t in paragraph.findall('.//w:t', ns))
        if text.startswith('En:'):
            word_english.append(text[3:])
    if not english or normalize(' '.join(english)) != normalize(' '.join(word_english)):
        raise ValueError('Word English sequence does not match the complete Markdown source layer.')
    pdf_text = subprocess.check_output(['pdftotext', '-layout', str(directory / 'guide.pdf'), '-'], text=True)
    pdf_pairs = len(re.findall(r'\bEn:', pdf_text))
    if len(english) != len(word_english) or pdf_pairs != len(english):
        raise ValueError('Exported Word/PDF English pair count differs from the complete Markdown.')
    return {'wordEnglishSequenceMatched': True, 'wordBilingualPairs': len(word_english), 'pdfBilingualPairs': pdf_pairs,
            'printSafeSymbols': {'♦': '◆'} if '♦' in ''.join(english) else {}}

if __name__ == '__main__':
    print(json.dumps(check(sys.argv[1])))
