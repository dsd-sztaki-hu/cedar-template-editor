from flask import Flask, request, jsonify
from flask_cors import CORS
from json_schema_converter import convert_schemas
import os
import argparse

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

arp_base_domain = "https://resource.arp.orgx"
dtr_url = "https://typeregistry.lab.pidconsortium.net/objects"

@app.route('/convert', methods=['POST'])
def convert_schema():
    try:
        # Get request data
        data = request.get_json()
        
        # Validate required fields
        if not data or 'source_id' not in data or 'direction' not in data:
            return jsonify({
                'error': 'Missing required fields. Please provide source_id, and direction'
            }), 400
            
        # Validate direction
        if data['direction'] not in ['dtrToCedar', 'cedarToDtr']:
            return jsonify({
                'error': 'Invalid direction. Must be either "dtrToCedar" or "cedarToDtr"'
            }), 400
            
        if data['parent_folder_id']:
            cedar_data = {
                "api_key": "apiKey " + api_key,
                "parent_folder_id": data['parent_folder_id'],
                "arp_base_domain": arp_base_domain,
                "dtr_url": dtr_url
            }
        else:
            cedar_data = None
            
        # Perform conversion
        result = convert_schemas(
            source_id=data['source_id'],
            direction=data['direction'],
            save_to_file=False,
            cedar_data=cedar_data
        )
        
        if result is None:
            return jsonify({
                'error': 'Conversion failed. Please check your input data and try again.'
            }), 500
            
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'error': f'An error occurred: {str(e)}'
        }), 500

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Run the schema conversion server')
    parser.add_argument('--arp-base-domain', type=str, default='https://resource.arp.orgx',
                      help='Base arp domain (default: https://resource.arp.orgx)')
    parser.add_argument('--port', type=int, default=5001,
                      help='Port to run the server on (default: 5001)')
    parser.add_argument('--dtr-url', type=str, default='https://typeregistry.lab.pidconsortium.net/objects',
                      help='DTR URL (default: https://typeregistry.lab.pidconsortium.net/objects)')
    parser.add_argument('--api-key', type=str, default='0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff',
                      help='API key (default: 0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff)')
    
    args = parser.parse_args()
    arp_base_domain = args.arp_base_domain
    dtr_url = args.dtr_url
    api_key = args.api_key
    
    app.run(debug=True, host='localhost', port=args.port) 