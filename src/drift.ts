/**
 * Pure logic -- no `vscode` dependency. Ported from the IntelliJ-
 * family postman-openapi-drift-companion (PostmanCollectionParser +
 * OpenApiPathScanner + PathMatcher). The collection parser uses
 * `JSON.parse()` here instead of real JSON PSI (simpler, no PSI
 * needed for structural traversal); OpenApiPathScanner and
 * PathMatcher are already line/regex-based in the original with no
 * PSI dependency, ported near-verbatim.
 */

export interface PostmanEndpoint {
  method: string;
  pathSegments: string[];
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function segmentsFromRaw(raw: string | undefined): string[] {
  if (!raw) return [];
  const withoutQuery = raw.split('?')[0];
  const withoutVarPrefix = withoutQuery.replace(/^\{\{[^}]*}}/, '');
  const withoutProtocolHost = withoutVarPrefix.replace(/^https?:\/\//, '');
  const afterFirstSlash = withoutProtocolHost.includes('/')
    ? withoutProtocolHost.slice(withoutProtocolHost.indexOf('/') + 1)
    : '';
  return afterFirstSlash.split('/').filter((segment) => segment.trim() !== '');
}

/** Reads every item[].request from a parsed Postman collection.
 * `item` arrays nest (folders contain items), so this walks
 * recursively. Matches the real Postman Collection Format v2.1.0
 * schema: request.url.path is the segment-array form; request.url.raw
 * is the fallback string form for a request whose URL was never split
 * into path. */
export function findEndpoints(collection: JsonValue): PostmanEndpoint[] {
  const endpoints: PostmanEndpoint[] = [];
  if (!isRecord(collection)) return endpoints;
  const items = collection.item;
  if (Array.isArray(items)) collectFromItems(items, endpoints);
  return endpoints;
}

function collectFromItems(items: JsonValue[], out: PostmanEndpoint[]): void {
  for (const element of items) {
    if (!isRecord(element)) continue;

    const nestedItems = element.item;
    if (Array.isArray(nestedItems)) {
      collectFromItems(nestedItems, out);
      continue;
    }

    const request = element.request;
    if (!isRecord(request)) continue;
    const method = typeof request.method === 'string' ? request.method : 'GET';
    const urlValue = request.url;

    let segments: string[];
    if (isRecord(urlValue)) {
      const pathArray = Array.isArray(urlValue.path) ? urlValue.path : undefined;
      const raw = typeof urlValue.raw === 'string' ? urlValue.raw : undefined;
      segments = pathArray
        ? pathArray.filter((segment): segment is string => typeof segment === 'string')
        : segmentsFromRaw(raw);
    } else if (typeof urlValue === 'string') {
      segments = segmentsFromRaw(urlValue);
    } else {
      continue;
    }
    if (segments.length === 0) continue;

    out.push({ method: method.toUpperCase(), pathSegments: segments });
  }
}

const YAML_PATH_KEY = /^\s{2,}(\/\S*):\s*$/;
const JSON_PATH_KEY = /"(\/[^"]*)"\s*:\s*\{/;
const PATHS_ROOT_YAML = /^paths:\s*$/;
const PATHS_ROOT_JSON = /"paths"\s*:\s*\{/;

/** Plain-text scan for a `paths:` (YAML) or `"paths"` (JSON) OpenAPI/
 * Swagger document -- indentation/brace scanning, no grammar parser,
 * since a spec can be either format. Returns the set of path
 * templates declared under paths:, e.g. /users/{id}/orders. Doesn't
 * resolve $ref -- a spec that only declares paths via external
 * references produces an honestly empty set (never a false
 * "path not found" for those). */
export function scanOpenApiPaths(text: string): Set<string> {
  const lines = text.split('\n');
  const isJson = text.trimStart().startsWith('{');
  const paths = new Set<string>();

  if (isJson) {
    let insidePaths = false;
    let depth = 0;
    for (const line of lines) {
      if (!insidePaths) {
        if (PATHS_ROOT_JSON.test(line)) {
          insidePaths = true;
          depth = 1;
        }
        continue;
      }
      depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      const match = JSON_PATH_KEY.exec(line);
      if (match) paths.add(match[1]);
      if (depth <= 0) insidePaths = false;
    }
  } else {
    let insidePaths = false;
    for (const line of lines) {
      if (!insidePaths) {
        if (PATHS_ROOT_YAML.test(line)) insidePaths = true;
        continue;
      }
      if (line.trim() !== '' && !line.startsWith(' ') && !line.startsWith('\t')) {
        insidePaths = false;
        continue;
      }
      const match = YAML_PATH_KEY.exec(line);
      if (match) paths.add(match[1]);
    }
  }
  return paths;
}

const PLACEHOLDER = /^(\{[^}]*}|\{\{[^}]*}}|:.+)$/;

function isPlaceholder(segment: string): boolean {
  return PLACEHOLDER.test(segment);
}

function segmentsMatch(postmanSegments: string[], specSegments: string[]): boolean {
  if (postmanSegments.length !== specSegments.length) return false;
  return postmanSegments.every((postmanSeg, i) => {
    const specSeg = specSegments[i];
    return isPlaceholder(postmanSeg) || isPlaceholder(specSeg) || postmanSeg === specSeg;
  });
}

/** Compares a Postman endpoint's path segments against the set of
 * OpenAPI path templates, segment by segment, treating any
 * placeholder-shaped segment as a wildcard on both sides -- OpenAPI
 * uses {id}, Postman uses :id (path variable) or {{id}} (collection/
 * environment variable). A literal segment must match exactly. */
export function existsInSpec(postmanSegments: string[], openApiPaths: Set<string>): boolean {
  if (openApiPaths.size === 0) return true; // no spec found/parsed -- honestly "can't evaluate", never a false positive
  for (const specPath of openApiPaths) {
    const specSegments = specPath.replace(/^\/|\/$/g, '').split('/');
    if (segmentsMatch(postmanSegments, specSegments)) return true;
  }
  return false;
}
