"""Unit tests for Google Colab URL & .ipynb Notebook Parser."""

import json

import pytest

from app.services.notebook_parser import (
    NotebookParseError,
    extract_drive_file_id_from_colab_url,
    parse_ipynb_bytes,
)


def test_extract_colab_and_drive_file_ids():
    assert (
        extract_drive_file_id_from_colab_url("https://colab.research.google.com/drive/1AbCdEfGhIjKlMnOpQrStUvWxYz123456")
        == "1AbCdEfGhIjKlMnOpQrStUvWxYz123456"
    )
    assert (
        extract_drive_file_id_from_colab_url("https://drive.google.com/file/d/1XyZ9876543210AbCdEf/view?usp=sharing")
        == "1XyZ9876543210AbCdEf"
    )
    with pytest.raises(NotebookParseError):
        extract_drive_file_id_from_colab_url("https://example.com/not-a-colab-link")


def test_parse_multicell_ipynb_preserves_order_and_strips_magics():
    nb = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {},
        "cells": [
            {"cell_type": "markdown", "metadata": {}, "source": ["# Queue Lab"]},
            {
                "cell_type": "code",
                "metadata": {},
                "execution_count": 1,
                "source": ["!pip install something\n", "q = []\n", "q.append(10)\n"],
                "outputs": [{"output_type": "stream", "name": "stdout", "text": ["fake output\n"]}],
            },
            {
                "cell_type": "code",
                "metadata": {},
                "execution_count": 2,
                "source": ["print(q.pop(0))\n"],
                "outputs": [],
            },
        ],
    }
    parsed = parse_ipynb_bytes(json.dumps(nb).encode("utf-8"))
    assert len(parsed.cells) == 3
    assert len(parsed.markdown_cells) == 1
    assert len(parsed.code_cells) == 2
    assert "# [notebook-magic-disabled] !pip install something" in parsed.code_bundle
    assert "q.append(10)" in parsed.code_bundle
    assert "print(q.pop(0))" in parsed.code_bundle
    assert parsed.code_cells[0].saved_outputs[0]["text"] == "fake output\n"
