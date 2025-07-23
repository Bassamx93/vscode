/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event, Emitter } from '../../../base/common/event.js';
import { MarkdownString } from '../../../base/common/htmlContent.js';
import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { revive } from '../../../base/common/marshalling.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IChatAgentRequest } from '../../contrib/chat/common/chatAgents.js';
import { IChatContentInlineReference, IChatProgress } from '../../contrib/chat/common/chatService.js';
import { ChatSession, IChatSessionContentProvider, IChatSessionItem, IChatSessionItemProvider, IChatSessionsService } from '../../contrib/chat/common/chatSessionsService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { Dto } from '../../services/extensions/common/proxyIdentifier.js';
import { ExtHostContext, IChatProgressDto, MainContext, MainThreadChatSessionsShape } from '../common/extHost.protocol.js';

@extHostNamedCustomer(MainContext.MainThreadChatSessions)
export class MainThreadChatSessions extends Disposable implements MainThreadChatSessionsShape {
	private readonly _itemProvidersRegistrations = this._register(new DisposableMap<number>());
	private readonly _contentProvidersRegisterations = this._register(new DisposableMap<number>());

	// Store progress emitters for active sessions: key is `${handle}_${requestId}`
	private readonly _activeProgressEmitters = new Map<string, Emitter<IChatProgress[]>>();

	// Store completion emitters for sessions: key is `${handle}_${requestId}`
	private readonly _completionEmitters = new Map<string, Emitter<void>>();

	constructor(
		private readonly _extHostContext: IExtHostContext,
		@IChatSessionsService private readonly _chatSessionsService: IChatSessionsService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	$registerChatSessionItemProvider(handle: number, chatSessionType: string): void {
		// Register the provider handle - this tracks that a provider exists
		const provider: IChatSessionItemProvider = {
			chatSessionType,
			provideChatSessionItems: (token) => this._provideChatSessionItems(handle, token)
		};

		this._itemProvidersRegistrations.set(handle, this._chatSessionsService.registerChatSessionItemProvider(provider));
	}

	private async _provideChatSessionItems(handle: number, token: CancellationToken): Promise<IChatSessionItem[]> {
		const proxy = this._extHostContext.getProxy(ExtHostContext.ExtHostChatSessions);

		try {
			// Get all results as an array from the RPC call
			const sessions = await proxy.$provideChatSessionItems(handle, token);
			return sessions.map(session => ({
				...session,
				id: session.id,
				iconPath: session.iconPath ? this._reviveIconPath(session.iconPath) : undefined
			}));
		} catch (error) {
			this._logService.error('Error providing chat sessions:', error);
		}
		return [];
	}

	private async _provideChatSessionContent(handle: number, id: string, token: CancellationToken): Promise<ChatSession> {
		const proxy = this._extHostContext.getProxy(ExtHostContext.ExtHostChatSessions);

		try {
			const sessionContent = await proxy.$provideChatSessionContent(handle, id, token);
			const _progressEmitter = new Emitter<IChatProgress[]>;
			const _completionEmitter = new Emitter<void>();
			let progressEvent: Event<IChatProgress[]> | undefined = undefined;
			if (sessionContent.activeResponseCallback) {
				// set progress
				progressEvent = _progressEmitter.event;
				// store the event emitter using a key that combines handle and session id
				const progressKey = `${handle}_${id}`;
				this._activeProgressEmitters.set(progressKey, _progressEmitter);
				this._completionEmitters.set(progressKey, _completionEmitter);
			}

			const result: ChatSession = {
				id: sessionContent.id,
				history: sessionContent.history.map(turn => {
					if (turn.type === 'request') {
						return { type: 'request', prompt: turn.prompt };
					}

					return {
						type: 'response',
						parts: turn.parts.map(part => revive(part) as IChatProgress)
					};
				}),
				progressEvent: progressEvent
			};

			// Only add the requestHandler if the session supports it
			if (sessionContent.supportRequestHandler) {
				result.requestHandler = async (request: IChatAgentRequest, progress: (progress: IChatProgress[]) => void, history: any, token: CancellationToken) => {
					// store the progress
					const requestId = request.requestId;
					const progressKey = `${handle}_${requestId}`; // TODO: KEY???
					const _progressEmitter = new Emitter<IChatProgress[]>();
					this._activeProgressEmitters.set(progressKey, _progressEmitter);
					this._completionEmitters.set(progressKey, _completionEmitter);

					progress([{
						kind: 'markdownContent',
						content: new MarkdownString('osvaldo!')
					}]);

					// Set up the progress event listener
					const progressListener = _progressEmitter.event(e => {
						// progress(e);  // TODO:
						progress([{
							kind: 'markdownContent',
							content: new MarkdownString('josh!')
						}]);
					});

					// Invoke the request handler on the extension host
					try {
						return await proxy.$invokeChatSessionRequestHandler(handle, id, request, history, token);
					} finally {
						progressListener.dispose();
					}
				};
			}

			return result;
		} catch (error) {
			this._logService.error(`Error providing chat session content for handle ${handle} and id ${id}:`, error);
			throw error; // Re-throw to propagate the error
		}
	}

	$unregisterChatSessionItemProvider(handle: number): void {
		this._itemProvidersRegistrations.deleteAndDispose(handle);
	}

	$registerChatSessionContentProvider(handle: number, chatSessionType: string): void {
		const provider: IChatSessionContentProvider = {
			chatSessionType,
			provideChatSessionContent: (id, token) => this._provideChatSessionContent(handle, id, token)
		};

		this._contentProvidersRegisterations.set(handle, this._chatSessionsService.registerChatSessionContentProvider(provider));
	}

	$unregisterChatSessionContentProvider(handle: number): void {
		this._contentProvidersRegisterations.deleteAndDispose(handle);
	}

	async $handleProgressChunk(handle: number, requestId: string, chunks: (IChatProgressDto | [IChatProgressDto, number])[]): Promise<void> {
		const progressKey = `${handle}_${requestId}`;
		const progressEmitter = this._activeProgressEmitters.get(progressKey);

		if (!progressEmitter) {
			this._logService.warn(`No progress emitter found for handle ${handle} and requestId ${requestId}`);
			return;
		}

		// Convert the chunks to IChatProgress[] and emit them
		const chatProgressParts: IChatProgress[] = chunks.map(chunk => {
			const [progress] = Array.isArray(chunk) ? chunk : [chunk];
			return revive(progress) as IChatProgress;
		});

		progressEmitter.fire(chatProgressParts);
	}

	$handleProgressComplete(handle: number, requestId: string) {
		const progressKey = `${handle}_${requestId}`;
		const progressEmitter = this._activeProgressEmitters.get(progressKey);
		const completionEmitter = this._completionEmitters.get(progressKey);

		if (!progressEmitter) {
			this._logService.warn(`No progress emitter found for handle ${handle} and requestId ${requestId}`);
			return;
		}

		// TODO: Fire a completion event through the progress emitter
		const completionProgress: IChatProgress = {
			kind: 'progressMessage',
			content: { value: 'Session completed', isTrusted: false }
		};
		progressEmitter.fire([completionProgress]);

		// Fire completion event if someone is listening
		if (completionEmitter) {
			completionEmitter.fire();
		}

		// Clean up the emitters
		progressEmitter.dispose();
		completionEmitter?.dispose();
		this._activeProgressEmitters.delete(progressKey);
		this._completionEmitters.delete(progressKey);
	}

	$handleAnchorResolve(handle: number, requestId: string, requestHandle: string, anchor: Dto<IChatContentInlineReference>): void {
		// throw new Error('Method not implemented.');
	}

	override dispose(): void {
		// Clean up all active progress emitters
		for (const emitter of this._activeProgressEmitters.values()) {
			emitter.dispose();
		}
		this._activeProgressEmitters.clear();

		// Clean up all completion emitters
		for (const emitter of this._completionEmitters.values()) {
			emitter.dispose();
		}
		this._completionEmitters.clear();

		super.dispose();
	}

	private _reviveIconPath(
		iconPath: UriComponents | { light: UriComponents; dark: UriComponents } | { id: string; color?: { id: string } | undefined })
		: IChatSessionItem['iconPath'] {
		if (!iconPath) {
			return undefined;
		}

		// Handle ThemeIcon (has id property)
		if (typeof iconPath === 'object' && 'id' in iconPath) {
			return iconPath; // ThemeIcon doesn't need conversion
		}

		// Handle light/dark theme icons
		if (typeof iconPath === 'object' && ('light' in iconPath && 'dark' in iconPath)) {
			return {
				light: URI.revive(iconPath.light),
				dark: URI.revive(iconPath.dark)
			};
		}
		return undefined;
	}
}
