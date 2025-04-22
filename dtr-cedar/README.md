# DTR-CEDAR Schema Converter

A Python-based tool for converting from DTR to CEDAR schema formats.

## Overview

This tool provides:
- REST API endpoint for schema conversion
- Support for complex nested structures
- Property mapping using TSV files
- CEDAR API integration for direct uploads

## Installation

1. Clone the repository
2. Install dependencies:
```bash
pip install flask flask-cors requests
```

## Usage

### Running the Server

Start the conversion server with default settings:

```bash
python app.py
```

Optional arguments:
- `--port`: Server port (default: 5001)
- `--arp-base-domain`: Base ARP domain
- `--dtr-url`: DTR URL
- `--api-key`: CEDAR API key

### REST API Endpoint

Convert schemas using the REST API:

```bash
POST http://localhost:5001/convert
```

Request body:
```json
{
    "source_id": "your_schema_id", // DTR resource id
    "direction": "dtrToCedar",
    "parent_folder_id": "cedar_folder_id"
}
```