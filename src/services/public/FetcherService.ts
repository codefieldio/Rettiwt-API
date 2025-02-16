import https, { Agent } from 'https';

import axios, { AxiosHeaders } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Auth, AuthCredential } from 'rettiwt-auth';

import { allowGuestAuthentication, fetchResources, postResources } from '../../collections/Groups';
import { requests } from '../../collections/Requests';
import { EApiErrors } from '../../enums/Api';
import { ELogActions } from '../../enums/Logging';
import { EResourceType } from '../../enums/Resource';
import { FetchArgs } from '../../models/args/FetchArgs';
import { PostArgs } from '../../models/args/PostArgs';
import { IErrorHandler } from '../../types/ErrorHandler';
import { IRettiwtConfig } from '../../types/RettiwtConfig';

import { ErrorService } from '../internal/ErrorService';
import { LogService } from '../internal/LogService';

import { AuthService } from './AuthService';
import { TxIdGeneratorOptions } from '../../types/TxIdGeneratorOptions';

/**
 * The base service that handles all HTTP requests.
 *
 * @public
 */
export class FetcherService {
	/** The api key to use for authenticating against Twitter API as user. */
	private readonly _apiKey?: string;

	/** The service used to handle HTTP and API errors */
	private readonly _errorHandler: IErrorHandler;

	/** The guest key to use for authenticating against Twitter API as guest. */
	private readonly _guestKey?: string;

	/** Optional function for generating client transaction ids (x-client-transaction-id */
	private readonly _txIdGeneratorFn?: (options: TxIdGeneratorOptions) => Promise<string>;

	/** The URL To the proxy server to use for all others. */
	private readonly _proxyUrl?: URL;

	/** The max wait time for a response. */
	private readonly _timeout: number;

	/** The URL to the proxy server to use only for authentication. */
	protected readonly authProxyUrl?: URL;

	/** The id of the authenticated user (if any). */
	protected readonly userId?: string;

	/**
	 * @param config - The config object for configuring the Rettiwt instance.
	 */
	public constructor(config?: IRettiwtConfig) {
		LogService.enabled = config?.logging ?? false;
		this._apiKey = config?.apiKey;
		this._guestKey = config?.guestKey;
		this._txIdGeneratorFn = config?.txIdGeneratorFn;
		this.userId = config?.apiKey ? AuthService.getUserId(config.apiKey) : undefined;
		this.authProxyUrl = config?.authProxyUrl ?? config?.proxyUrl;
		this._proxyUrl = config?.proxyUrl;
		this._timeout = config?.timeout ?? 0;
		this._errorHandler = config?.errorHandler ?? new ErrorService();
	}

	/**
	 * Checks the authorization status based on the requested resource.
	 *
	 * @param resource - The requested resource.
	 *
	 * @throws An error if not authorized to access the requested resource.
	 */
	private checkAuthorization(resource: EResourceType): void {
		// Logging
		LogService.log(ELogActions.AUTHORIZATION, { authenticated: this.userId != undefined });

		// Checking authorization status
		if (!allowGuestAuthentication.includes(resource) && this.userId == undefined) {
			throw new Error(EApiErrors.RESOURCE_NOT_ALLOWED);
		}
	}

	/**
	 * Returns the AuthCredentials based on the type of key present.
	 *
	 * @returns The generated AuthCredential
	 */
	private async getCredential(): Promise<AuthCredential> {
		if (this._apiKey) {
			// Logging
			LogService.log(ELogActions.GET, { target: 'USER_CREDENTIAL' });

			return new AuthCredential(AuthService.decodeCookie(this._apiKey).split(';'));
		} else if (this._guestKey) {
			// Logging
			LogService.log(ELogActions.GET, { target: 'GUEST_CREDENTIAL' });

			return new AuthCredential(undefined, this._guestKey);
		} else {
			// Logging
			LogService.log(ELogActions.GET, { target: 'NEW_GUEST_CREDENTIAL' });

			return await new Auth({ proxyUrl: this.authProxyUrl }).getGuestCredential();
		}
	}

	/**
	 * Generates the x-client-transaction-id header for the request.
	 */
	private async getTransactionIdHeader(
		url?: string,
		generateTransactionId?: (options: TxIdGeneratorOptions) => Promise<string>
	): Promise<AxiosHeaders> {
		const headers = new AxiosHeaders();

		if (!generateTransactionId || !url?.trim()) {
			return headers;
		}

		try {
			console.log(`[${Math.floor(Date.now() / 60000)}] Rettiwt requesting transaction id...`);
			const txId = await generateTransactionId({url, guestKey: this._guestKey!});
			if (txId?.trim()) {
				console.log(`[${Math.floor(Date.now() / 60000)}] Rettiwt received transaction id ${txId.substring(0, 6)}`);
				console.log(`[${Math.floor(Date.now() / 60000)}] Attached transaction id to request ${txId.substring(0, 6)}`);
				headers['x-client-transaction-id'] = txId;
			}
		} catch (error) {
			LogService.log(ELogActions.REQUEST, { target: 'TX_ID_GENERATION', error });
		}
		return headers;
	}

	/**
	 * Gets the https agent based on whether a proxy is used or not.
	 *
	 * @param proxyUrl - Optional URL with proxy configuration to use for requests to Twitter API.
	 *
	 * @returns The https agent to use.
	 */
	private getHttpsAgent(proxyUrl?: URL): Agent {
		if (proxyUrl) {
			// Logging
			LogService.log(ELogActions.GET, { target: 'HTTPS_PROXY_AGENT' });

			return new HttpsProxyAgent(proxyUrl);
		} else {
			// Logging
			LogService.log(ELogActions.GET, { target: 'HTTPS_AGENT' });

			return new https.Agent();
		}
	}

	/**
	 * Validates the given args against the given resource.
	 *
	 * @param resource - The resource against which validation is to be done.
	 * @param args - The args to be validated.
	 *
	 * @returns The validated args.
	 */
	private validateArgs(resource: EResourceType, args: FetchArgs | PostArgs): FetchArgs | PostArgs | undefined {
		if (fetchResources.includes(resource)) {
			// Logging
			LogService.log(ELogActions.VALIDATE, { target: 'FETCH_ARGS' });

			return new FetchArgs(resource, args);
		} else if (postResources.includes(resource)) {
			// Logging
			LogService.log(ELogActions.VALIDATE, { target: 'POST_ARGS' });

			return new PostArgs(resource, args);
		}
	}

	/**
	 * Makes an HTTP request according to the given parameters.
	 *
	 * @param resource - The requested resource.
	 * @param config - The request configuration.
	 *
	 * @typeParam T - The type of the returned response data.
	 *
	 * @returns The raw data response received.
	 *
	 * @example
	 * Fetching the raw details of a user with username 'user1'
	 * ```
	 * import { FetcherService, EResourceType } from 'rettiwt-api';
	 *
	 * // Creating a new FetcherService instance using the given 'API_KEY'
	 * const fetcher = new FetcherService({ apiKey: API_KEY });
	 *
	 * // Fetching the details of the User with username 'user1'
	 * fetcher.request(EResourceType.USER_DETAILS_BY_USERNAME, { id: 'user1' })
	 * .then(res => {
	 * 	console.log(res);
	 * })
	 * .catch(err => {
	 * 	console.log(err);
	 * })
	 * ```
	 */
	public async request<T>(resource: EResourceType, args: FetchArgs | PostArgs): Promise<T> {
		// Logging
		LogService.log(ELogActions.REQUEST, { resource: resource, args: args });

		// Checking authorization for the requested resource
		this.checkAuthorization(resource);

		// Validating args
		args = this.validateArgs(resource, args)!;

		// Getting HTTPS agent
		const httpsAgent: Agent = this.getHttpsAgent(this._proxyUrl);

		// Getting credentials from key
		const cred: AuthCredential = await this.getCredential();

		// Getting request configuration
		const config = requests[resource](args);

		// Adding transaction id header
		const txIdHeader = await this.getTransactionIdHeader(config.url, this._txIdGeneratorFn);

		// Setting additional request parameters
		config.headers = {
			...config.headers,
			...cred.toHeader(),
			...txIdHeader
		}
		config.httpAgent = httpsAgent;
		config.httpsAgent = httpsAgent;
		config.timeout = this._timeout;

		// Sending the request
		try {
			// Returning the reponse body
			return (await axios<T>(config)).data;
		} catch (error) {
			// If error, delegate handling to error handler
			this._errorHandler.handle(error);
			throw error;
		}
	}
}
