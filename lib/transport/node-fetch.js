'use strict';

const Transport = require('./transport');
const https = require('node:https');
// eslint-disable-next-line func-style
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const REQUIRED_PROPERTIES = [
  'body',
  'elapsedTime',
  'url',
  'statusCode',
  'headers'
];

class FetchTransport extends Transport {
  constructor(options) {
    super();
    if (options?.agentOpts) {
      this._agent = new https.Agent(options.agentOpts);
    }

    this.defaults = options?.defaults;

    this._fetch = fetch;
  }

  toOptions(ctx) {
    const req = ctx.req;
    const opts = ctx.opts || {};

    opts.timeout = req.getTimeout() || this.defaults?.timeout;
    opts.compress = this.defaults?.compress;

    if (req.hasQueries()) opts.searchParams = new URLSearchParams(req.getQueries());

    const body = ctx.req.getBody();
    if (body) {
      if (typeof body === 'object') {
        req.addHeader('Content-type', 'application/json');
        opts.body = JSON.stringify(body);
      } else {
        opts.body = body;
      }
    }

    if (req.hasHeaders()) opts.headers = req.getHeaders();

    return opts;
  }

  async toResponse(ctx, from) {
    const to = ctx.res;
    const contentType = from.headers?.get('content-type');
    REQUIRED_PROPERTIES.forEach((property) => {
      to[property] = from[property];
    });

    to.statusCode = from.status;

    // currently supports json and text formats only
    if (from.ok) {
      if (contentType?.includes('json')) {
        to.body = await from.json();
      } else if (contentType?.includes('text')) {
        to.body = await from.text();
      }
    }

    to.httpResponse = from;
    return to;
  }

  async makeRequest(ctx, opts) {
    const controller = new AbortController();
    const method = ctx.req.getMethod();
    let fetchedResponse;

    opts = {
      ...opts,
      method,
      agent: this._agent,
      signal: controller.signal
    };

    const timeout = opts.timeout && setTimeout(() => {
      controller.abort();
    }, opts.timeout);

    try {
      const start = process.hrtime.bigint();
      fetchedResponse = await this._fetch(ctx.req.getUrl(), opts);
      fetchedResponse.elapsedTime = Math.round(Number(process.hrtime.bigint() - start) / 1e6); // nanoseconds to milliseconds
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('ESOCKETTIMEDOUT');
      } else {
        throw new Error(err.message);
      }
    } finally {
      clearTimeout(timeout);
    }

    return fetchedResponse;
  }
}

module.exports = FetchTransport;