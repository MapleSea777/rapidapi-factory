'use strict';

/**
 * Generates an OpenAPI 3.0 spec for each API product.
 * RapidAPI accepts OpenAPI/Swagger imports, so each generated spec can be
 * pasted straight into the RapidAPI hub to create a new API listing.
 */

function buildSpec(product, baseUrl) {
  const paths = {};
  for (const ep of product.endpoints) {
    const method = (ep.method || 'GET').toLowerCase();
    const parameters = [];
    const required = [];
    for (const p of ep.params || []) {
      if (method === 'get') {
        parameters.push({
          name: p.name,
          in: 'query',
          required: !!p.required,
          description: p.description || '',
          schema: { type: p.type || 'string', ...(p.example !== undefined ? { example: p.example } : {}) },
        });
      }
      if (p.required) required.push(p.name);
    }

    const op = {
      summary: ep.summary || ep.path,
      description: ep.description || ep.summary || '',
      operationId: ep.operationId || `${product.prefix.replace(/\//g, '')}${ep.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      tags: [product.name],
      responses: {
        200: {
          description: 'Successful response',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        400: { description: 'Bad request' },
        429: { description: 'Rate limit exceeded' },
      },
    };
    if (parameters.length) op.parameters = parameters;
    if (method === 'post') {
      const properties = {};
      for (const p of ep.params || []) {
        properties[p.name] = {
          type: p.type || 'string',
          description: p.description || '',
          ...(p.example !== undefined ? { example: p.example } : {}),
        };
      }
      op.requestBody = {
        required: required.length > 0,
        content: {
          'application/json': {
            schema: { type: 'object', properties, ...(required.length ? { required } : {}) },
          },
        },
      };
    }
    paths[ep.path] = { [method]: op };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: product.name,
      description: product.description || product.tagline || '',
      version: '1.0.0',
    },
    servers: [{ url: baseUrl }],
    paths,
  };
}

module.exports = { buildSpec };
