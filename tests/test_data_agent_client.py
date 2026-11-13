import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("check_data_agent", ROOT / "scripts" / "check_data_agent.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_json_and_sse_mcp_responses_match_request_identity():
    message = {"jsonrpc": "2.0", "id": 3, "result": {"content": [{"type": "text", "text": "source result"}]}}
    serialized = json.dumps(message)
    assert module.decode_rpc(serialized, "application/json", 3) == message["result"]
    stream = f'event: message\r\ndata: {serialized}\r\n\r\n'
    assert module.decode_rpc(stream, "text/event-stream", 3) == message["result"]
    with pytest.raises(ValueError, match="identity"):
        module.decode_rpc(serialized, "application/json", 4)
    with pytest.raises(ValueError, match="exactly one"):
        module.decode_rpc(stream + stream, "text/event-stream", 3)


def test_mcp_error_is_not_an_empty_success():
    with pytest.raises(ValueError, match="MCP error"):
        module.decode_rpc('{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"Denied"}}',
                          "application/json", 1)


def test_only_the_declared_adversarial_content_filter_is_an_expected_block():
    case = {"expectedServiceBlock": "content_filter"}
    response = {"isError": True, "content": [{"type": "text",
        "text": "The Data Agent run was incomplete before producing a result. Reason: content_filter."}]}
    assert module.expected_block(case, response)
    assert not module.expected_block({}, response)
    response["content"][0]["text"] = "Authentication failed."
    assert not module.expected_block(case, response)
