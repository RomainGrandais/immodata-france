'use strict';

const { McpServer }                   = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z }                           = require('zod');
const { buildResponse }               = require('../lib/core');
const { checkApiKey }                 = require('../lib/auth');

// ── Handler Vercel ─────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'MCP utilise POST.' });
  }

  // Auth
  const authError = checkApiKey(req);
  if (authError) return res.status(authError.status).json(authError);

  // Instanciation du serveur MCP (stateless — une instance par requête Vercel)
  const server = new McpServer({
    name: 'immodata-france',
    version: '1.0.0',
  });

  // ── Outil : rechercher_bien ──────────────────────────────────────────────
  server.tool(
    'rechercher_bien',
    'Analyse immobilière complète d\'une adresse française. Retourne le prix au m², la tendance du marché, le DPE dominant, le statut zone tendue et un résumé en langage naturel.',
    {
      adresse: z
        .string()
        .min(5)
        .max(200)
        .describe('Adresse complète en France, ex: "12 rue de la Paix Lyon"'),
      format: z
        .enum(['ai', 'raw'])
        .default('ai')
        .describe('"ai" inclut le résumé Claude (défaut). "raw" retourne les données brutes sans appel LLM.'),
    },
    async ({ adresse, format }) => {
      try {
        const data = await buildResponse(adresse, format);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(data, null, 2),
          }],
        };
      } catch (err) {
        if (err.code === 'ADRESSE_INTROUVABLE') {
          return {
            content: [{ type: 'text', text: `Adresse introuvable : "${adresse}". Vérifiez l'orthographe.` }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: 'Erreur lors de la récupération des données. Réessayez.' }],
          isError: true,
        };
      }
    }
  );

  // ── Transport HTTP stateless ─────────────────────────────────────────────
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless : compatible Vercel serverless
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
};
