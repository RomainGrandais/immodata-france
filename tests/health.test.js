'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/health');

function createRes() {
  const res = {
    _status: null, _body: null, _headers: {},
    status(c) { this._status = c; return this; },
    json(d)   { this._body = d;  return this; },
    end()     { return this; },
    setHeader(k, v) { this._headers[k] = v; },
  };
  return res;
}

describe('GET /health', () => {
  it('retourne 200 avec status ok', () => {
    const res = createRes();
    handler({ method: 'GET', headers: {} }, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.status, 'ok');
  });

  it('retourne version et timestamp', () => {
    const res = createRes();
    handler({ method: 'GET', headers: {} }, res);
    assert.ok(res._body.version);
    assert.ok(res._body.timestamp);
    assert.ok(!isNaN(Date.parse(res._body.timestamp)), 'timestamp doit être une date ISO valide');
  });

  it('OPTIONS → 204', () => {
    const res = createRes();
    handler({ method: 'OPTIONS', headers: {} }, res);
    assert.equal(res._status, 204);
  });

  it('POST → 405', () => {
    const res = createRes();
    handler({ method: 'POST', headers: {} }, res);
    assert.equal(res._status, 405);
  });
});
