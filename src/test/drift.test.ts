import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findEndpoints, scanOpenApiPaths, existsInSpec } from '../drift';

test('findEndpoints reads a request with a path-segment-array URL', () => {
  const collection = {
    item: [{ request: { method: 'get', url: { path: ['users', '{id}', 'orders'] } } }],
  };
  const endpoints = findEndpoints(collection);
  assert.equal(endpoints.length, 1);
  assert.equal(endpoints[0].method, 'GET');
  assert.deepEqual(endpoints[0].pathSegments, ['users', '{id}', 'orders']);
});

test('findEndpoints falls back to raw URL string when there is no path array', () => {
  const collection = {
    item: [{ request: { method: 'POST', url: { raw: 'https://api.example.com/users/:id' } } }],
  };
  const endpoints = findEndpoints(collection);
  assert.equal(endpoints.length, 1);
  assert.deepEqual(endpoints[0].pathSegments, ['users', ':id']);
});

test('findEndpoints handles a bare string url', () => {
  const collection = { item: [{ request: { method: 'DELETE', url: 'https://api.example.com/users/:id' } }] };
  const endpoints = findEndpoints(collection);
  assert.equal(endpoints.length, 1);
});

test('findEndpoints recurses into nested folders', () => {
  const collection = {
    item: [
      {
        name: 'a folder',
        item: [{ request: { method: 'GET', url: { path: ['users'] } } }],
      },
    ],
  };
  const endpoints = findEndpoints(collection);
  assert.equal(endpoints.length, 1);
});

test('findEndpoints defaults to GET when method is missing', () => {
  const collection = { item: [{ request: { url: { path: ['users'] } } }] };
  const endpoints = findEndpoints(collection);
  assert.equal(endpoints[0].method, 'GET');
});

test('scanOpenApiPaths reads YAML paths', () => {
  const text = ['openapi: 3.0.0', 'paths:', '  /users:', '    get:', '  /users/{id}:', '    get:', 'components:'].join(
    '\n',
  );
  const paths = scanOpenApiPaths(text);
  assert.deepEqual([...paths].sort(), ['/users', '/users/{id}']);
});

test('scanOpenApiPaths reads JSON paths', () => {
  // Pretty-printed, like a real hand-edited OpenAPI spec -- the
  // scanner is line-oriented (same as the IntelliJ-family original),
  // not a real JSON parser, so it expects one path key per line.
  const text = JSON.stringify({ paths: { '/users': { get: {} }, '/users/{id}': { get: {} } } }, null, 2);
  const paths = scanOpenApiPaths(text);
  assert.deepEqual([...paths].sort(), ['/users', '/users/{id}']);
});

test('existsInSpec matches a literal path exactly', () => {
  assert.equal(existsInSpec(['users'], new Set(['/users'])), true);
  assert.equal(existsInSpec(['orders'], new Set(['/users'])), false);
});

test('existsInSpec treats OpenAPI {id} and Postman :id as matching wildcards', () => {
  assert.equal(existsInSpec(['users', ':id'], new Set(['/users/{id}'])), true);
});

test('existsInSpec treats a Postman {{variable}} segment as a wildcard', () => {
  assert.equal(existsInSpec(['{{baseId}}', 'orders'], new Set(['/users/orders'])), true);
});

test('existsInSpec returns true (cannot evaluate) when there is no spec', () => {
  assert.equal(existsInSpec(['anything'], new Set()), true);
});
