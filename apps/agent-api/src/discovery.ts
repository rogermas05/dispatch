/**
 * Discovery surface for other agents: llms.txt to read, OpenAPI to act on.
 *
 * llms.txt explains what Dispatch is and when to use it. It is not enough on
 * its own — an assistant that can only read cannot place a call — so the same
 * capability is published as an OpenAPI document that imports directly as a
 * ChatGPT Action or any other tool-calling integration.
 */

export function llmsTxt(baseUrl: string): string {
	return `# Dispatch

> Dispatch places real phone calls on behalf of a person or another AI agent.
> Give it a number and an objective; it dials, navigates phone menus, waits on
> hold, pursues the objective within the authority you grant it, and returns a
> transcript plus a structured outcome.

It exists because agents cannot make phone calls. No phone number, no telephony,
no way to hold a real-time conversation. If your task dead-ends at "someone needs
to ring them", this is the part you are missing.

## When to use it

- Information only a human on a phone will give you: stock, availability, why a
  claim was denied, what a policy actually covers.
- Anything behind a phone tree or a hold queue.
- Confirming, chasing or following up where there is no API.

Do not use it for cold calls, sales calls, or anything in bulk. Dispatch calls
people and businesses on behalf of someone with a reason to contact them.

## Place a call

\`\`\`http
POST ${baseUrl}/v1/call
Content-Type: application/json

{
  "to": "+14155550123",
  "objective": "Ask whether prescription RX4417892 is ready for pickup, and if not, when it will be.",
  "authorization": "Confirm the patient name only. Do not change, cancel or transfer the prescription.",
  "on_behalf_of": "Aman"
}
\`\`\`

Returns \`202\` with a \`call_id\`. Calls take a few minutes.

\`\`\`http
GET ${baseUrl}/v1/call/{call_id}
\`\`\`

Poll roughly every 30 seconds until \`status\` is \`completed\` or \`failed\`.

## Writing a good brief

**objective** — what you need, in one or two sentences. Say what counts as an
answer, not just the topic.

**authorization** — what Dispatch may agree to. Be specific and conservative;
anything outside it gets escalated rather than improvised. This text is hashed
on-chain, so it is the record of what was permitted. Omit it and the call
gathers information and commits to nothing.

**on_behalf_of** — who the call is for. Used in the greeting, so the person
answering hears why their phone rang.

## What you get back

A transcript, a one-line summary, any reference numbers obtained, what still
needs a human, and what the call does *not* establish. A transcript proves what
was said, never that it was true — Dispatch says so rather than implying
otherwise.

## Payment

Dispatch is registered on the Masumi network and settles in USDM on Cardano.
Price is quoted per call, scaling with expected duration — a short question
costs less than one that may sit on hold.

Through \`/v1/call\` the escrow is handled for you. If a call does not complete,
no result hash is submitted and the escrow refunds automatically: nobody is
charged for a call that did not happen.

Masumi-native agents can hire Dispatch directly over MIP-003 instead
(\`POST /start_job\`, see \`${baseUrl}/input_schema\`) and fund the escrow from
their own wallet.

## Honesty

Dispatch identifies itself as an AI when asked. It does not pretend to be human,
and it does not exceed what you authorized.

## Machine-readable

- OpenAPI: ${baseUrl}/openapi.json
- MIP-003 input schema: ${baseUrl}/input_schema
- Availability: ${baseUrl}/availability
`;
}

export function openApiSpec(baseUrl: string): Record<string, unknown> {
	return {
		openapi: '3.1.0',
		info: {
			title: 'Dispatch',
			description:
				'Places real phone calls on behalf of a person or another AI agent. Use it when a task needs someone rung up: information only a human on a phone will give, anything behind a phone tree or hold queue, confirmations and chases where no API exists. Not for cold calls, sales calls, or bulk outreach.',
			version: '1.0.0',
		},
		servers: [{ url: baseUrl }],
		paths: {
			'/v1/call': {
				post: {
					operationId: 'placeCall',
					summary: 'Place a phone call and return a call_id to poll',
					description:
						'Starts a real phone call. Returns immediately with a call_id — calls take a few minutes, so poll getCallStatus until it is completed or failed. Payment is handled automatically; a call that does not complete is refunded.',
					requestBody: {
						required: true,
						content: {
							'application/json': {
								schema: {
									type: 'object',
									required: ['to', 'objective'],
									properties: {
										to: { type: 'string', description: 'Number to dial in E.164 format, e.g. +14155550123' },
										objective: {
											type: 'string',
											description:
												'What the call must achieve, in one or two sentences. Say what counts as an answer, not just the topic.',
										},
										authorization: {
											type: 'string',
											description:
												'What Dispatch may agree to on the caller’s behalf. Be conservative — anything outside this is escalated rather than improvised, and this text is hashed on-chain as the record of what was permitted. Omit for information-only.',
										},
										on_behalf_of: {
											type: 'string',
											description: 'Who the call is for. Used in the greeting so the person answering hears why their phone rang.',
										},
										context: { type: 'string', description: 'Facts needed on the call: account or order numbers, names, dates.' },
									},
								},
							},
						},
					},
					responses: {
						'202': {
							description: 'Call accepted and paying',
							content: {
								'application/json': {
									schema: {
										type: 'object',
										properties: {
											call_id: { type: 'string' },
											status: { type: 'string' },
											price_usdm: { type: 'string', nullable: true },
											message: { type: 'string' },
											poll_after_seconds: { type: 'integer' },
										},
									},
								},
							},
						},
						'400': { description: 'Invalid request' },
						'503': { description: 'Dispatch is unavailable' },
					},
				},
			},
			'/v1/call/{call_id}': {
				get: {
					operationId: 'getCallStatus',
					summary: 'Check a call and collect its result',
					description:
						'Poll roughly every 30 seconds. While status is awaiting_payment or running the call is still in progress. When completed, result holds the transcript and outcome.',
					parameters: [{ name: 'call_id', in: 'path', required: true, schema: { type: 'string' } }],
					responses: {
						'200': {
							description: 'Call state',
							content: {
								'application/json': {
									schema: {
										type: 'object',
										properties: {
											call_id: { type: 'string' },
											status: { type: 'string', enum: ['awaiting_payment', 'running', 'completed', 'failed'] },
											explanation: { type: 'string' },
											result: { type: 'string', description: 'Transcript and structured outcome, once completed.' },
											output_hash: { type: 'string', description: 'SHA-256 of the delivered result, committed on-chain.' },
											error: { type: 'string' },
											poll_after_seconds: { type: 'integer' },
										},
									},
								},
							},
						},
						'404': { description: 'Unknown call_id' },
					},
				},
			},
		},
	};
}
