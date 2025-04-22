import json
import os
import csv
import requests
import datetime
import uuid
from typing import Dict, Any, Tuple, Literal, Optional, List
from urllib.parse import quote, unquote

def get_nested_value(data: Dict[str, Any], path: str) -> Optional[Any]:
    """
    Get a value from a nested dictionary using dot notation and array indexing.
    
    Args:
        data: The dictionary to search in
        path: Path to the value (e.g., "metadata.author.name" or Aliases[0]")
        
    Returns:
        The value if found, None otherwise
    """
    try:
        if not path:  # Handle empty or None path
            print("Warning: Empty path provided to get_nested_value")
            return None
            
        current = data
        path = path.strip()  # Clean up any whitespace
        
        if not path:  # Handle path that becomes empty after stripping
            print("Warning: Path is empty after stripping whitespace")
            return None
            
        for part in path.split('.'):
            part = part.strip()  # Clean up any whitespace
            
            if not part:  # Skip empty parts
                print(f"Warning: Empty part in path {path}")
                continue
                
            # Handle array indexing
            if '[' in part and ']' in part:
                key = part[:part.index('[')].strip()
                index = int(part[part.index('[')+1:part.index(']')])
                if isinstance(current, dict):
                    current = current.get(key)
                    if isinstance(current, list) and 0 <= index < len(current):
                        current = current[index]
                    else:
                        print(f"Warning: Array access failed for path {path}. Current value: {current}")
                        return None
                else:
                    print(f"Warning: Expected dict for array access at {path}. Got {type(current)}")
                    return None
            # Handle regular dictionary access
            elif isinstance(current, dict):
                current = current.get(part)
                if current is None:
                    print(f"Warning: Key {part} not found in path {path}")
                    return None
            else:
                print(f"Warning: Expected dict for key access at {path}. Got {type(current)}")
                return None
        return current
    except Exception as e:
        print(f"Error in get_nested_value for path {path}: {str(e)}")
        return None

def set_nested_value(data: Dict[str, Any], path: str, value: Any) -> None:
    """
    Set a value in a nested dictionary using dot notation and array indexing.
    Creates intermediate dictionaries if they don't exist.
    Also ensures the property is properly defined in schema properties.
    
    Args:
        data: The dictionary to modify
        path: Path to set the value (e.g., "metadata.author.name" or "aliases[0]")
        value: The value to set
    """
    try:
        if value is None:
            return
        
        current = data
        path = path.strip()  # Clean up any whitespace
        parts = path.split('.')
        
        # Navigate to the second-to-last part
        for part in parts[:-1]:
            part = part.strip()  # Clean up any whitespace
            if '[' in part and ']' in part:
                key = part[:part.index('[')].strip()
                if key not in current:
                    current[key] = []
                current = current[key]
            else:
                if part not in current:
                    current[part] = {}
                current = current[part]
        
        # Handle the last part
        last_part = parts[-1].strip()
        if '[' in last_part and ']' in last_part:
            key = last_part[:last_part.index('[')].strip()
            index = int(last_part[last_part.index('[')+1:last_part.index(']')])
            if key not in current:
                current[key] = []
            # Extend list if needed
            while len(current[key]) <= index:
                current[key].append(None)
            current[key][index] = value
        else:
            current[last_part] = value
            
    except Exception as e:
        print(f"Error in set_nested_value for path {path}: {str(e)}")

def read_json_schema(template_name):
    try:
        # Get the absolute path to the resources directory
        current_dir = os.path.dirname(os.path.abspath(__file__))
        file_path = os.path.join(current_dir, 'resources', template_name)
        
        # Read and parse the JSON file
        with open(file_path, 'r') as file:
            data = json.load(file)
            
        # Print the contents in a readable format
        # print(json.dumps(data, indent=2))
        return data
    except FileNotFoundError:
        print(f"Error: Could not find the file at {file_path}")
    except json.JSONDecodeError:
        print("Error: The file contains invalid JSON")
    except Exception as e:
        print(f"An unexpected error occurred: {str(e)}")

def read_bidirectional_mapping(
    mapping_file: str,
    direction: Literal["dtrToCedar", "cedarToDtr"]
) -> Dict[str, str]:
    """
    Reads property mappings from a TSV file and creates a direction-specific mapping.
    
    Args:
        mapping_file: Name of the TSV file containing mappings
        direction: "dtrToCedar" (DTR → Cedar) or "cedarToDtr" (Cedar → DTR)
        
    Returns:
        Dict[str, str]: Dictionary mapping source paths to target paths based on direction
    """
    try:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        file_path = os.path.join(current_dir, 'resources', mapping_file)
        
        mappings = {}
        with open(file_path, 'r') as f:
            reader = csv.DictReader(f, delimiter='\t')
            for row in reader:
                if direction == "dtrToCedar":
                    mappings[row['dtr']] = row['cedar']
                else:
                    mappings[row['cedar']] = row['dtr']
        
        return mappings
    except FileNotFoundError:
        print(f"Error: Could not find mapping file at {file_path}")
        return {}
    except Exception as e:
        print(f"Error reading mapping file: {str(e)}")
        return {}

def convert_basic_info_type_to_template_field(
    source_data: Dict[str, Any],
    mapping: Dict[str, str],
    overridden_values: Dict[str, str] = None,
    skip_adding_id: bool = True,
    cedar_data: Dict[str, Any] = None,
    create_folder: bool = True
) -> Dict[str, Any]:
    """
    Convert the DTR basic info type to CEDAR template field.
    """

    target_data = read_json_schema("cedarTemplateField.json")

    # Process the conversion
    converted_data = process_common_properties(
        source_data=source_data,
        target_data=target_data,
        direction="dtrToCedar",
        mapping=mapping,
        overridden_values=overridden_values,
        skip_adding_id=skip_adding_id
    )

    converted_data = convert_props_from_dtr_to_cedar(
        source_data=source_data["Schema"],
        target_data=converted_data
    )

    if cedar_data:
        converted_data = upload_resource_to_cedar(
            resource=converted_data,
            cedar_data=cedar_data,
            create_folder=create_folder
        )

    return converted_data
    

def convert_schemas(
    source_id: str,
    direction: Literal["dtrToCedar", "cedarToDtr"],
    save_to_file: bool = False,
    cedar_data: Dict[str, Any] = None
) -> Dict[str, Any]:
    """
    Convert between DTR and CEDAR JSON schemas.
    
    Args:
        source_json: Name of the source JSON file
        target_json: Name of the target JSON file
        direction: "dtrToCedar" (DTR → Cedar) or "cedarToDtr" (Cedar → DTR)
        mapping: Dictionary of property mappings. If None, will read from default mapping file
        save_to_file: Whether to save changes to file
        
    Returns:
        Dict[str, Any]: The converted schema data
    """
    try:
        # Read source and target schemas
        # source_data = read_json_schema(source_json)
        source_data = get_resource(source_id, cedar_data["dtr_url"])
           
        mapping = read_bidirectional_mapping(mapping_file="common_prop_mappings.tsv", direction=direction)
        if not mapping:
            print(f"Error: Failed to read property mappings")
            return None
        
        # converted_data = process_common_properties(
        #     source_data=source_data,
        #     target_data=target_data,
        #     direction=direction,
        #     mapping=mapping
        # )

        # else:
        #     converted_data = convert_from_cedar_to_dtr(
        #         source_data=source_data,
        #         target_data=converted_data
        #     )

        if source_data["type"] == "BasicInfoType":
            converted_data = convert_basic_info_type_to_template_field(
                source_data=source_data["content"],
                mapping=mapping,
                cedar_data=cedar_data,
                create_folder=False
            )
        else:
            if source_data["type"] == "InfoType":
                target_data = read_json_schema("cedarTemplateElement.json")
                create_folder = False
            else:
                target_data = read_json_schema("cedarSchemaTemplate.json")
                create_folder = True
                name = source_data["content"]["name"] + "_" + datetime.datetime.now().strftime("%m%d_%H%M")
                cedar_data["template_folder_id"] = normalize_cedar_url(create_cedar_folder(name, "Template from the DTR.", cedar_data))

            converted_data = convert_complex_dtr_to_cedar(
                source_data=source_data["content"],
                target_data=target_data,
                cedar_data=cedar_data,
                create_folder=create_folder,
                skip_adding_id=True
            )

            if cedar_data:
                converted_data = upload_resource_to_cedar(
                    resource=converted_data,
                    cedar_data=cedar_data,
                    create_folder=create_folder
                )

        # Save to file if requested
        if save_to_file and converted_data:
            try:
                current_dir = os.path.dirname(os.path.abspath(__file__))
                output_filename = 'dtrToCedar.json' if direction == "dtrToCedar" else 'cedarToDtr.json'
                output_path = os.path.join(current_dir, 'results', output_filename)
                
                # Ensure results directory exists
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                
                with open(output_path, 'w') as f:
                    json.dump(converted_data, f, indent=2)
                print(f"Successfully saved conversion to {output_path}")
            except Exception as e:
                print(f"Error saving conversion to file: {str(e)}")
        
        return converted_data
        
    except Exception as e:
        print(f"Error during schema conversion: {str(e)}")
        return None
    
def upload_resource_to_cedar(
    resource: Dict[str, Any],
    cedar_data: Dict[str, Any],
    create_folder: bool = True
) -> Dict[str, Any]:
    """
    Upload a resource to CEDAR.
    """

    headers = {
        'Content-Type': 'application/json',
        'Authorization': cedar_data["api_key"]
    }

    cedar_type = resource["@type"].rsplit('/', 1)[-1]
    if cedar_type == "TemplateField":
        if create_folder:
            if "fields_folder_id" not in cedar_data:
                cedar_data["fields_folder_id"] = normalize_cedar_url(create_cedar_folder("Fields", "Fields from the DTR.", cedar_data))
                folder_id = cedar_data["fields_folder_id"]
        else:
            folder_id = cedar_data["parent_folder_id"]
        url = cedar_data["arp_base_domain"] + "/template-fields?folder_id=" + folder_id
        print('uploading field', url, json.dumps(resource, indent=2))
        response = requests.post(url, json=resource, headers=headers, verify=False)
        print('field response', response.status_code)

    elif cedar_type == "TemplateElement":
        if create_folder:
            if "elements_folder_id" not in cedar_data:
                cedar_data["elements_folder_id"] = normalize_cedar_url(create_cedar_folder("Elements", "Elements from the DTR.", cedar_data))
                folder_id = cedar_data["elements_folder_id"]
        else:
            folder_id = cedar_data["parent_folder_id"]
        url = cedar_data["arp_base_domain"] + "/template-elements?folder_id=" + folder_id
        response = requests.post(url, json=resource, headers=headers, verify=False) 
        print('element response', response.status_code)

    elif cedar_type == "Template":
        if "template_folder_id" in cedar_data:
            folder_id = cedar_data["template_folder_id"]
        else:
            folder_id = cedar_data["parent_folder_id"]
        url = cedar_data["arp_base_domain"] + "/templates?folder_id=" + folder_id
        response = requests.post(url, json=resource, headers=headers, verify=False)
        print('template response', response.status_code)

    else:
        print(f"Error: Unsupported resource type: {cedar_type}")
        return None

    if response.status_code == 201:
        return response.json()
    else:
        print(f"Error: Failed to upload resource to CEDAR. Status code: {response.json()}")
        return None
        
def create_cedar_folder(name, description, cedar_data):
    print(f"Creating {name, description, cedar_data} folder")
    headers = {
        'Authorization': cedar_data["api_key"]
    }
    url = cedar_data["arp_base_domain"] + "/folders"
    folder_id = cedar_data["template_folder_id"] if "template_folder_id" in cedar_data else cedar_data["parent_folder_id"]
    data = {
        "folderId": unquote(folder_id),
        "name": name,
        "description": description
    }
    response = requests.post(url, headers=headers, json=data, verify=False)
    if response.status_code == 201:
        folder_json = json.loads(response.text)
        return folder_json["@id"]
    else:
        print(f"Error: Failed to create folder in CEDAR. Status code: {response.json()}")
        return None

def normalize_cedar_url(url: str) -> str:
    """
    Convert a CEDAR URL to its percent-encoded format if not already encoded.
    
    Args:
        url: The URL to normalize (e.g. "https://repo.arp.orgx/template-elements/123...")
        
    Returns:
        str: The percent-encoded URL (e.g. "https:%2F%2Frepo.arp.orgx%2Ftemplate-elements%2F123...")
    """
    try:
        # First check if the URL is already encoded by trying to decode it
        try:
            unquote(url)
            if '%2F' in url:  # If URL contains encoded slashes, it's already encoded
                return url
        except Exception:
            pass
        
        # If we get here, URL needs encoding
        # Split the URL into protocol and rest to preserve the first //
        if '://' in url:
            protocol, rest = url.split('://', 1)
            # Encode everything after the protocol
            return f"{protocol}:{quote(f'//{rest}', safe='')}"
        else:
            # If no protocol, encode everything
            return quote(url, safe='')
            
    except Exception as e:
        print(f"Error normalizing URL {url}: {str(e)}")
        return url
    
def collect_overriden_values(
    property: Dict[str, Any],
    identifier: str
) -> Dict[str, str]:
    """
    Collect overridden values from the source data.
    """
    overridden_values = {
        "Identifier": identifier
    }
    if "Name" in property:
        overridden_values["name"] = property["Name"]
    if "Description" in property:
        overridden_values["description"] = property["Description"]
    if "Title" in property:
        overridden_values["title"] = property["Title"]

    cardinality = get_nested_value(property, "Properties.Cardinality")
    if cardinality is not None:
        overridden_values["Cardinality"] = cardinality
    
    return overridden_values

def add_dtr_resource_to_cedar_parent(
    source_data: Dict[str, Any],
    parent_data: Dict[str, Any],
    resource_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Add a dtr resource to its cedar parent.
    """
    resource_name = source_data["name"]
    order_array = get_nested_value(parent_data, "_ui.order")
    if resource_name not in order_array:
        parent_data["_ui"]["order"].append(resource_name)
    
    parent_data["_ui"]["propertyLabels"][resource_name] = resource_name
    if "description" in source_data:
        parent_data["_ui"]["propertyDescriptions"][resource_name] = source_data["description"]

    enum_obj = {
        "enum": [
            source_data["Identifier"]
          ]
    }
    parent_data["properties"]["@context"]["properties"][resource_name] = enum_obj
    
    required_array = parent_data["required"]
    if resource_name not in required_array:
        required_array.append(resource_name)

    if "title" in source_data:
        resource_data["skos:prefLabel"] = source_data["title"]
    parent_data["properties"][resource_name] = resource_data
    required_array = get_nested_value(parent_data, "properties.@context.required")
    if resource_name not in required_array:
        required_array.append(resource_name)
        
    return parent_data
        
def convert_complex_dtr_to_cedar(
    source_data: Dict[str, Any],
    target_data: Dict[str, Any],
    skip_adding_id: bool = True,
    overridden_values: Dict[str, str] = None,
    cedar_data: Dict[str, Any] = None,
    create_folder: bool = True
) -> Dict[str, Any]:
    """
    Convert a complex DTR structure (InfoType or Profile) to the corresponding CEDAR resource.
    """
    mapping = read_bidirectional_mapping(mapping_file="common_prop_mappings.tsv", direction="dtrToCedar")
    process_common_properties(
        source_data=source_data,
        target_data=target_data,
        direction="dtrToCedar",
        mapping=mapping,
        overridden_values=overridden_values,
        skip_adding_id=skip_adding_id
    )
    
    schema_type = get_nested_value(source_data, "Schema.Type")
    if schema_type != "Object":
        print("Schema is not an Object. Array type is not compatible with CEDAR. Terminating conversion.")
        return None
    
    properties = get_nested_value(source_data, "Schema.Properties")
    for property in properties:
        # In the DTR JSON Schema, the "Type" is the identifier of the resource
        source_data = get_resource(property["Type"], cedar_data["dtr_url"])
        
        overridden_values = collect_overriden_values(property, source_data["id"])
        
        if source_data["type"] == "BasicInfoType":
            if not create_folder:
                cedar_data = None

            cedar_field = convert_basic_info_type_to_template_field(
                source_data=source_data["content"],
                mapping=mapping,
                overridden_values=overridden_values,
                skip_adding_id=skip_adding_id,
                cedar_data=cedar_data,
                create_folder=create_folder
            )
            add_dtr_resource_to_cedar_parent(
                source_data=overridden_values,
                parent_data=target_data,
                resource_data=cedar_field,
            )
        else:
            print("processing complex DTR to CEDAR", source_data)
            element_template = read_json_schema("cedarTemplateElement.json")
            cedar_element = convert_complex_dtr_to_cedar(
                source_data=source_data["content"],
                target_data=element_template,
                overridden_values=overridden_values,
                cedar_data=cedar_data,
                create_folder=create_folder,
                skip_adding_id=skip_adding_id
            )
            if cedar_data:
                cedar_element = upload_resource_to_cedar(
                    resource=cedar_element,
                    cedar_data=cedar_data,
                    create_folder=create_folder
                )
            print("cedar_element", cedar_element)
            add_dtr_resource_to_cedar_parent(
                source_data=overridden_values,
                parent_data=target_data,
                resource_data=cedar_element
            )

    return target_data

def process_common_properties(
    source_data: Dict[str, Any],
    target_data: Dict[str, Any],
    direction: Literal["dtrToCedar", "cedarToDtr"],
    mapping: Dict[str, str] = None,
    overridden_values: Dict[str, str] = None,
    skip_adding_id: bool = True
) -> Dict[str, Any]:
    """
    Process and convert properties between DTR and Cedar JSON schemas.
    
    Args:
        source_data: Source schema data
        target_data: Target schema data
        direction: "dtrToCedar" (DTR → Cedar) or "cedarToDtr" (Cedar → DTR)
        mapping: Dictionary of property mappings
        overridden_values: Overridden values for fields that have been overridden in the parent resource

    Returns:
        Dict[str, Any]: The processed target data
    """
    print("overridden_values", json.dumps(overridden_values, indent=2), "target_data", json.dumps(target_data, indent=2))

    # Process each property
    for source_path, target_path in mapping.items():
        print(f"Processing common property: source_path: {source_path}, target_path: {target_path}")
        value = get_nested_value(source_data, source_path)
        if value is not None:
            set_nested_value(target_data, target_path, value)

    if overridden_values:
        for key, value in overridden_values.items():
            if key not in ["Identifier", "Cardinality"]:
                set_nested_value(target_data, mapping[key], value)

        if "Cardinality" in overridden_values:
            is_required = overridden_values["Cardinality"] in ["1", "1 - n"]
            set_nested_value(target_data, "_valueConstraints.requiredValue", is_required)
            multiple_allowed = overridden_values["Cardinality"] in ["0 - n", "1 - n"]
            if multiple_allowed:
                set_nested_value(target_data, "minItems", 1)
                set_nested_value(target_data, "maxItems", 0)

    # Save additional CEDAR properties
    if direction == "dtrToCedar":
        field_name = source_data["name"] if overridden_values is None else overridden_values["name"]
        if not skip_adding_id:
            set_nested_value(target_data, "@id", str(uuid.uuid4()))
        set_nested_value(target_data, "title", field_name + " field schema")
        set_nested_value(target_data, "description", field_name + " generated by the DTR-CEDAR converter")
        set_nested_value(target_data, "schema:identifier", field_name)
    
    return target_data

def convert_props_from_dtr_to_cedar(
    source_data: Dict[str, Any],
    target_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Convert properties from DTR basic info type to CEDAR JSON field.
    """
    # Get value constraint mappings
    constraint_mapping = read_bidirectional_mapping(
        mapping_file="value_constraint_mappings.tsv",
        direction="dtrToCedar"
    )
    
    if not constraint_mapping:
        print(f"Error: Failed to read mappings")
        return None
    
    dtr_type = source_data["Type"]
    set_cedar_type(dtr_type, target_data)

    # Set the PropRelations
    if "PropRelations" in source_data:
        if dtr_type in ["Integer", "Number"]:
            set_nested_value(target_data, "_valueConstraints.propRelations", source_data["PropRelations"])
        else:
            set_nested_value(target_data, "_arp.dtr.common.propRelations", source_data["PropRelations"])

    target_data = enum_from_dtr_to_cedar(source_data["Properties"][0], target_data) if dtr_type == "Enum" else props_from_dtr_to_cedar(source_data["Properties"], target_data, constraint_mapping)
    return target_data

def convert_from_cedar_to_dtr(
    source_data: Dict[str, Any],
    target_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Convert properties from CEDAR to DTR JSON schema.
    """
    cedar_type = get_nested_value(source_data, "_ui.inputType")
    set_dtr_type(cedar_type, target_data)

    # Set the PropRelations
    set_nested_value(target_data, "Schema.PropRelations", get_nested_value(source_data, "_valueConstraints.propRelations") or get_nested_value(source_data, "_arp.dtr.common.propRelations"))

    target_data = list_from_cedar_to_dtr(source_data, target_data) if cedar_type == "list" else props_from_cedar_to_dtr(source_data, target_data)
    
    return target_data

def list_from_cedar_to_dtr(
    source_data: Dict[str, Any],
    target_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Convert literals from CEDAR JSON schema list elements to DTR.
    CEDAR only supports enum lists with literals, so only String Enum is supported..
    """
    cedar_list = get_nested_value(source_data, "_valueConstraints.literals")
    dtr_list = []
    for elem in cedar_list:
        dtr_list.append(elem["label"])

    dtr_enum_obj = {
        "Property": "String Enum",
        "Value": dtr_list
    }

    print("target", target_data)

    set_nested_value(target_data, "Schema.Properties[0]", dtr_enum_obj)

    return target_data


def props_from_cedar_to_dtr(
    source_data: Dict[str, Any],
    target_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Convert properties from CEDAR to DTR JSON schema.
    """

    # Get value constraint mappings
    constraint_mapping = read_bidirectional_mapping(
        mapping_file="value_constraint_mappings.tsv",
        direction="cedarToDtr"
    )
    
    if not constraint_mapping:
        print(f"Error: Failed to read mappings")
        return target_data

    # Handle value constraints separately
    if "_valueConstraints" in source_data:
        constraints = source_data["_valueConstraints"]
        excluded_keys = ["requiredValue"]  # Keys to skip
        filtered_constraints = {
            k: v for k, v in constraints.items() 
            if k not in excluded_keys
        }

        print('adding empty properties', filtered_constraints)

        if filtered_constraints and "Properties" not in target_data["Schema"]:
            target_data["Schema"]["Properties"] = []
            props = target_data["Schema"]["Properties"]
        
        # Map each constraint using the dedicated mapping
        for cedar_key, value in filtered_constraints.items():
            if cedar_key in constraint_mapping:
                dtr_key = constraint_mapping[cedar_key]
                props.append({
                    "Property": dtr_key,
                    "Value": value
                })

    # Set the specific properties too
    if "_arp.dtr.specific" in source_data:
        if "Properties" not in target_data["Schema"]:
            print('adding empty properties2')
            target_data["Schema"]["Properties"] = []
            props = target_data["Schema"]["Properties"]

        for specific_key, value in source_data["_arp.dtr.specific"].items():
            props.append({
                "Property": specific_key,
                "Value": value
            })

    
    return target_data

def props_from_dtr_to_cedar(
    source_data: Dict[str, Any],
    target_data: Dict[str, Any],
    constraint_mapping: Dict[str, str] = None
) -> Dict[str, Any]:
    """
    Convert properties from DTR to CEDAR JSON schema.
    """
        
    # Map DTR properties to Cedar constraints
    for pair in source_data:
        property_name = pair.get("Property")
        value = pair.get("Value")
        print(f"Processing property: {property_name}, value: {value}")
        
        if property_name is None or value is None:
            print(f"Warning: Invalid property-value pair: {pair}")
            continue
            
        # Find the mapping for this property
        if property_name in constraint_mapping:
            cedar_path = constraint_mapping[property_name]
            set_nested_value(target_data, f"_valueConstraints.{cedar_path}", value)
        else:
            set_nested_value(target_data, f"_arp.dtr.specific.{property_name}", value)
            
    return target_data

def enum_from_dtr_to_cedar(
    source_data: Dict[str, Any],
    target_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Convert enum properties from DTR to CEDAR JSON schema list elements.
    CEDAR only supports enum lists with literals, so we need to convert the DTR enum to a list of literals.
    Only String Enum is supported.
    """
    print(source_data)
    if source_data["Property"] == "String Enum":
        enum_list = source_data["Value"]
        cedar_list = []
        print("enum list", enum_list)
        for value in enum_list:
            cedar_list.append({
                "label": value
            })
        set_nested_value(target_data, "_valueConstraints.literals", cedar_list)

    return target_data

def set_dtr_type(cedar_type: str, target_data: Dict[str, Any]) -> None:
    """
    Set the type of the DTR JSON schema.
    """
    match cedar_type:
        case "textfield":
            dtr_type = "String"
        case "xsd:int":
            dtr_type = "Integer"
        case "xsd:double":
            dtr_type = "Number"
        case "list":
            dtr_type = "Enum"

    set_nested_value(target_data, "Schema.Type", dtr_type)

def set_cedar_type(dtr_type: str, target_data: Dict[str, Any]) -> None:
    """
    Set the type of the Cedar JSON schema.
    """
    match dtr_type:
        case "String":
            cedar_type = "textfield"
        case "Integer":
            cedar_type = "xsd:int"
        case "Number":
            cedar_type = "xsd:double"
        case "Enum":
            cedar_type = "list"
    
    set_nested_value(target_data, "_ui.inputType", cedar_type)
            
def get_resource(id: str, dtr_url: str) -> Optional[Dict[str, Any]]:
    """
    Fetch a resource from the Type Registry API.
    
    Args:
        id: The ID of the resource to fetch
        
    Returns:
        Dict[str, Any]: The JSON response data, or None if the request failed
    """
    try:
        url = dtr_url + f"/{id}?full=true"
        response = requests.get(url)
        response.raise_for_status()  # Raise an exception for bad status codes
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching resource from {url}: {str(e)}")
        return None

# Example usage:
if __name__ == "__main__":
    # Example 1: Convert DTR to CEDAR
    converted_data = convert_schemas(
        source_id='strField.json',
        direction="dtrToCedar",
        save_to_file=True
    )
    
    # Example 2: Convert CEDAR to DTR
    converted_data = convert_schemas(
        source_id='cedarInput.json',
        direction="cedarToDtr",
        save_to_file=True
    ) 