"""Exercise the published Fabric data-agent MCP endpoint with a guarded in-memory token."""

import argparse
import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
MAX_RESPONSE = 1024 * 1024


def decode_rpc(content, content_type, request_id):
    if "text/event-stream" in content_type:
        messages = []
        for event in content.replace("\r\n", "\n").split("\n\n"):
            data = "\n".join(line[5:].lstrip() for line in event.splitlines() if line.startswith("data:"))
            if data:
                messages.append(json.loads(data))
        matches = [message for message in messages if message.get("id") == request_id]
        if len(matches) != 1:
            raise ValueError("MCP stream did not contain exactly one matching response.")
        response = matches[0]
    else:
        response = json.loads(content)
    if response.get("id") != request_id or response.get("jsonrpc") != "2.0":
        raise ValueError("MCP response identity/version mismatch.")
    if response.get("error"):
        error = response["error"]
        raise ValueError(f"MCP error {error.get('code')}: {str(error.get('message'))[:500]}")
    if "result" not in response:
        raise ValueError("MCP response contains no result.")
    return response["result"]


def expected_block(case, result):
    texts = [block.get("text", "") for block in result.get("content", []) if block.get("type") == "text"]
    return (
        case.get("expectedServiceBlock") == "content_filter"
        and result.get("isError") is True
        and texts == ["The Data Agent run was incomplete before producing a result. Reason: content_filter."]
    )


class FabricAgentClient:
    def __init__(self, workspace_id, agent_id, token):
        workspace_id = str(uuid.UUID(workspace_id))
        agent_id = str(uuid.UUID(agent_id))
        self.url = f"https://api.fabric.microsoft.com/v1/mcp/workspaces/{workspace_id}/dataagents/{agent_id}/agent"
        self.client = httpx.Client(timeout=httpx.Timeout(180, connect=15), follow_redirects=False)
        self.headers = {
            "Authorization": f"Bearer {token}", "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json", "x-ms-fabric-skill": "fabriciq-ontology-cli",
        }
        self.sequence = 0

    def send(self, method, params=None, notification=False):
        self.sequence += 1
        message = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        if not notification:
            message["id"] = self.sequence
        started = time.monotonic()
        with self.client.stream("POST", self.url, headers=self.headers, json=message) as response:
            if response.status_code not in (200, 202):
                raise ValueError(f"Fabric data-agent MCP returned HTTP {response.status_code}; no automatic retry or alternative identity.")
            if response.headers.get("mcp-session-id"):
                self.headers["Mcp-Session-Id"] = response.headers["mcp-session-id"]
            if notification:
                return None
            chunks, length = [], 0
            for chunk in response.iter_bytes():
                length += len(chunk)
                if length > MAX_RESPONSE or time.monotonic() - started > 180:
                    raise ValueError("MCP response exceeded the size/time bound; the request was not repeated.")
                chunks.append(chunk)
            content = b"".join(chunks).decode("utf-8")
            return decode_rpc(content, response.headers.get("content-type", ""), self.sequence)

    def initialize(self):
        result = self.send("initialize", {
            "protocolVersion": "2025-03-26", "capabilities": {},
            "clientInfo": {"name": "assayscope-read-only-verification", "version": "0.1.0"},
        })
        version = result.get("protocolVersion")
        if version not in ("2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"):
            raise ValueError("The server selected an unsupported MCP protocol version.")
        self.headers["MCP-Protocol-Version"] = version
        self.send("notifications/initialized", notification=True)
        tools = self.send("tools/list", {})
        if tools.get("nextCursor") or len(tools.get("tools", [])) != 1:
            raise ValueError("Expected the single published data-agent tool, not an arbitrary tool catalog.")
        tool = tools["tools"][0]
        properties = tool["inputSchema"].get("properties", {})
        required = tool["inputSchema"].get("required", [])
        if len(properties) != 1 or len(required) > 1:
            raise ValueError("Data-agent input schema is not the documented single-question form.")
        argument, schema = next(iter(properties.items()))
        if schema.get("type") != "string":
            raise ValueError("Data-agent question must be a string.")
        return {"name": tool["name"], "argument": argument, "protocolVersion": version}

    def close(self):
        if self.headers.get("Mcp-Session-Id"):
            response = self.client.delete(self.url, headers=self.headers)
            if response.status_code not in (200, 202, 204, 404, 405):
                self.client.close()
                raise ValueError(f"MCP session cleanup returned HTTP {response.status_code}.")
        self.client.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--agent", required=True)
    parser.add_argument("--case", help="Run one known evaluation case; default runs all seven.")
    parser.add_argument("--out", type=Path, default=ROOT / "test-results" / "data-agent-runtime.json")
    args = parser.parse_args()
    token = os.environ.get("ASSAYSCOPE_FABRIC_TOKEN")
    if not token:
        raise SystemExit("Use the guarded deployment wrapper to supply an in-memory Fabric token.")
    cases = json.loads((ROOT / "knowledge" / "evaluation.json").read_text(encoding="utf-8"))["cases"]
    if args.case:
        cases = [case for case in cases if case["id"] == args.case]
    if not cases or len(cases) > 10:
        raise SystemExit("Select a known bounded evaluation case.")
    report = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "scope": "Actual published Fabric data-agent MCP answers; statements still require comparison with deterministic evidence.",
        "cases": [],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    client = FabricAgentClient(args.workspace, args.agent, token)
    try:
        tool = client.initialize()
        report["discovery"] = tool
        for case in cases:
            started = time.monotonic()
            result = client.send("tools/call", {
                "name": tool["name"], "arguments": {tool["argument"]: case["question"]},
            })
            entry = {"id": case["id"], "question": case["question"], "elapsedSeconds": time.monotonic() - started,
                     "isError": bool(result.get("isError")), "result": result}
            entry["outcome"] = "Expected service content-filter block" if expected_block(case, result) else "Answer returned"
            report["cases"].append(entry)
            args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            if entry["isError"] and not expected_block(case, result):
                raise ValueError(f"The data agent returned a tool error for {case['id']}. Inspect the saved response.")
            print(f"Actual data-agent response saved: {case['id']} - {entry['outcome']} ({entry['elapsedSeconds']:.1f}s).")
        report["completedAt"] = datetime.now(timezone.utc).isoformat()
        report["status"] = "Responses collected; scientific/authorization evaluation is separate."
    except (httpx.HTTPError, ValueError, KeyError) as error:
        report["status"] = "Failed"
        report["error"] = str(error).replace(token, "[REDACTED]")
        raise SystemExit(report["error"]) from error
    finally:
        args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        client.close()


if __name__ == "__main__":
    main()
