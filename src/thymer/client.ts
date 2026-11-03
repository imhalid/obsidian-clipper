// Minimal client for the MCP server built into the Thymer desktop app.
// The server speaks JSON-RPC over HTTP on localhost and sends no CORS headers,
// so this must run in the background script (host permissions skip CORS there).

export const THYMER_BRIDGE_URL = 'http://127.0.0.1:13100';

const PROTOCOL_VERSION = '2025-03-26';

/** The desktop app is not running, or its MCP bridge is turned off. */
export class ThymerUnreachableError extends Error {
	constructor(message = 'Thymer is not running, or its MCP bridge is turned off') {
		super(message);
		this.name = 'ThymerUnreachableError';
	}
}

/** A tool ran and reported an error (record not found, bad property value, ...). */
export class ThymerToolError extends Error {
	constructor(public tool: string, message: string) {
		super(`${tool}: ${message}`);
		this.name = 'ThymerToolError';
	}
}

interface RpcResponse {
	result?: any;
	error?: { code: number; message: string };
}

export class ThymerClient {
	private sessionId: string | null = null;
	private nextId = 1;

	constructor(private baseUrl: string = THYMER_BRIDGE_URL) {}

	private async post(body: object): Promise<{ status: number; json: RpcResponse | null }> {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (this.sessionId) {
			headers['Mcp-Session-Id'] = this.sessionId;
		}
		let response: Response;
		try {
			response = await fetch(`${this.baseUrl}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
		} catch {
			throw new ThymerUnreachableError();
		}
		this.sessionId = response.headers.get('Mcp-Session-Id') || this.sessionId;
		const text = await response.text();
		return { status: response.status, json: text ? JSON.parse(text) : null };
	}

	private async connect(): Promise<void> {
		this.sessionId = null;
		const { json } = await this.post({
			jsonrpc: '2.0',
			id: this.nextId++,
			method: 'initialize',
			params: {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: 'thymer-clipper', version: '1' },
			},
		});
		if (!json?.result) {
			throw new ThymerUnreachableError(`Thymer's MCP bridge refused to connect: ${json?.error?.message || 'no answer'}`);
		}
		await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
	}

	/**
	 * Call a tool and return its result. Tools answer with one text part, which is
	 * JSON for most of them; anything that does not parse is returned as a string.
	 */
	async call<T = any>(tool: string, args: Record<string, unknown>): Promise<T> {
		if (!this.sessionId) {
			await this.connect();
		}
		const request = () => this.post({
			jsonrpc: '2.0',
			id: this.nextId++,
			method: 'tools/call',
			params: { name: tool, arguments: args },
		});
		let { status, json } = await request();
		// The session is gone when the app restarted since we connected
		if (status >= 400 || json?.error) {
			await this.connect();
			({ status, json } = await request());
		}
		if (json?.error) {
			throw new ThymerToolError(tool, json.error.message);
		}
		const text = (json?.result?.content || [])
			.filter((part: any) => part.type === 'text')
			.map((part: any) => part.text)
			.join('');
		if (json?.result?.isError) {
			throw new ThymerToolError(tool, text || 'unknown error');
		}
		try {
			return JSON.parse(text);
		} catch {
			return text as T;
		}
	}

	/** Upload a file through the bridge's HTTP endpoint and return its blob guid. */
	async uploadBlob(workspace: string, filename: string, mimeType: string, data: Blob | ArrayBuffer): Promise<string> {
		const { upload_url } = await this.call<{ upload_url: string }>('upload_file', {
			workspace,
			filename,
			mime_type: mimeType,
		});
		let response: Response;
		try {
			response = await fetch(upload_url, { method: 'POST', body: data });
		} catch {
			throw new ThymerUnreachableError();
		}
		const result = await response.json().catch(() => null);
		if (!response.ok || !result?.blob_guid) {
			throw new ThymerToolError('upload_file', result?.error || `upload failed (${response.status})`);
		}
		return result.blob_guid;
	}
}
