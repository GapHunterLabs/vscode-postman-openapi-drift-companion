import * as vscode from 'vscode';
import { findEndpoints, scanOpenApiPaths, existsInSpec } from './drift';
import { recordHit } from './reviewPrompt';

let diagnostics: vscode.DiagnosticCollection;

const SPEC_NAMES = ['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.yaml', 'swagger.yml', 'swagger.json'];
const MAX_DIRS_UP = 6;

function basename(uri: vscode.Uri): string {
  const path = uri.path;
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Walks up from the collection's own directory (bounded, never a
 * full-workspace scan) checking each directory for a conventionally-
 * named spec file. v0.1 scope, honestly noted (same as the
 * IntelliJ-family original): only directories on the path from the
 * collection to the root are checked -- a spec filed under an
 * unrelated sibling directory isn't found. */
async function findSpecText(collectionUri: vscode.Uri): Promise<string | null> {
  let dir = vscode.Uri.joinPath(collectionUri, '..');
  for (let hop = 0; hop < MAX_DIRS_UP; hop++) {
    for (const name of SPEC_NAMES) {
      const candidate = vscode.Uri.joinPath(dir, name);
      try {
        const bytes = await vscode.workspace.fs.readFile(candidate);
        return Buffer.from(bytes).toString('utf8');
      } catch {
        // not this one -- try the next name/directory
      }
    }
    const parent = vscode.Uri.joinPath(dir, '..');
    if (parent.path === dir.path) break; // reached the filesystem root
    dir = parent;
  }
  return null;
}

async function refresh(context: vscode.ExtensionContext, document: vscode.TextDocument): Promise<void> {
  if (!basename(document.uri).endsWith('.postman_collection.json')) {
    diagnostics.delete(document.uri);
    return;
  }

  let collection: unknown;
  try {
    collection = JSON.parse(document.getText());
  } catch {
    diagnostics.delete(document.uri);
    return;
  }

  const endpoints = findEndpoints(collection as never);
  if (endpoints.length === 0) {
    diagnostics.delete(document.uri);
    return;
  }

  const specText = await findSpecText(document.uri);
  if (!specText) {
    // No spec found nearby -- honestly "can't evaluate", never a false positive.
    diagnostics.delete(document.uri);
    return;
  }

  const openApiPaths = scanOpenApiPaths(specText);
  const missing = endpoints.filter((endpoint) => !existsInSpec(endpoint.pathSegments, openApiPaths));

  const result = missing.map((endpoint) => {
    const range = new vscode.Range(0, 0, 0, Number.MAX_SAFE_INTEGER);
    const diagnostic = new vscode.Diagnostic(
      range,
      `${endpoint.method} /${endpoint.pathSegments.join('/')} is in this collection but not in the nearby OpenAPI/Swagger spec -- possible drift.`,
      vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = 'Postman OpenAPI Drift Companion';
    recordHit(context, `${document.uri.toString()}:${endpoint.method}:${endpoint.pathSegments.join('/')}`);
    return diagnostic;
  });
  diagnostics.set(document.uri, result);
}

export function activate(context: vscode.ExtensionContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection('postmanOpenApiDriftCompanion');
  context.subscriptions.push(diagnostics);

  vscode.workspace.textDocuments.forEach((doc) => void refresh(context, doc));

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => void refresh(context, doc)),
    vscode.workspace.onDidChangeTextDocument((event) => void refresh(context, event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
  );
}

export function deactivate(): void {
  diagnostics?.dispose();
}
